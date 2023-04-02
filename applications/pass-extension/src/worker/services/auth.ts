/* eslint-disable @typescript-eslint/no-throw-literal */
import { c } from 'ttag';

import {
    checkSessionLock,
    consumeFork,
    exposeAuthStore,
    getPersistedSession,
    persistSession,
    resumeSession,
} from '@proton/pass/auth';
import { browserSessionStorage } from '@proton/pass/extension/storage';
import { notification, sessionLockSync, signout, stateLock } from '@proton/pass/store';
import type { Api, MaybeNull, WorkerForkMessage, WorkerMessageResponse } from '@proton/pass/types';
import { SessionLockStatus, WorkerMessageType, WorkerStatus } from '@proton/pass/types';
import { withPayload } from '@proton/pass/utils/fp';
import { logger } from '@proton/pass/utils/logger';
import { workerReady } from '@proton/pass/utils/worker';
import { getApiErrorMessage } from '@proton/shared/lib/api/helpers/apiErrorHelper';
import createAuthenticationStore, {
    AuthenticationStore,
} from '@proton/shared/lib/authentication/createAuthenticationStore';
import { MAIL_APP_NAME, PASS_APP_NAME } from '@proton/shared/lib/constants';
import createStore from '@proton/shared/lib/helpers/store';

import WorkerMessageBroker from '../channel';
import { withContext } from '../context';
import store from '../store';

type LoginOptions = {
    UID: string;
    AccessToken: string;
    RefreshToken: string;
    keyPassword: string;
};
export interface AuthService {
    authStore: AuthenticationStore;
    resumeSession: () => Promise<boolean>;
    consumeFork: (data: WorkerForkMessage['payload']) => Promise<WorkerMessageResponse<WorkerMessageType.FORK>>;
    login: (options: LoginOptions) => Promise<boolean>;
    logout: () => boolean;
    init: () => Promise<boolean>;
    lock: () => void;
    unlock: () => void;
}

type CreateAuthServiceOptions = {
    api: Api;
    onAuthorized?: () => void;
    onUnauthorized?: () => void;
};

type AuthContext = {
    pendingInit: MaybeNull<Promise<boolean>>;
    lockStatus: MaybeNull<SessionLockStatus>;
};

export const createAuthService = ({ api, onAuthorized, onUnauthorized }: CreateAuthServiceOptions): AuthService => {
    const authCtx: AuthContext = { pendingInit: null, lockStatus: null };

    const authService: AuthService = {
        authStore: exposeAuthStore(createAuthenticationStore(createStore())),

        lock: withContext((ctx) => {
            logger.info(`[Worker::Auth] Locking context`);
            const shouldLockState = workerReady(ctx.status);

            /* set the lock status before dispatching
             * the `stateLock` so the UI can pick up
             * the locked state before wiping the store */
            authCtx.lockStatus = SessionLockStatus.LOCKED;
            ctx.setStatus(WorkerStatus.LOCKED);

            if (shouldLockState) {
                logger.info(`[Worker::Auth] Locking state`);
                store.dispatch(stateLock());
            }
        }),

        unlock: () => {
            logger.info(`[Worker::Auth] Unlocking context`);
            authCtx.lockStatus = SessionLockStatus.REGISTERED;
        },

        init: async () => {
            logger.info(`[Worker::Auth] Initialization start`);

            if (authCtx.pendingInit !== null) {
                logger.info(`[Worker::Auth] Ongoing auth initialization..`);
                return authCtx.pendingInit;
            }

            authCtx.pendingInit = Promise.resolve(
                (async () => {
                    const { UID, AccessToken, RefreshToken, keyPassword } = await browserSessionStorage.getItems([
                        'UID',
                        'AccessToken',
                        'RefreshToken',
                        'keyPassword',
                    ]);

                    if (UID && keyPassword && AccessToken && RefreshToken) {
                        return authService.login({ UID, keyPassword, AccessToken, RefreshToken });
                    }

                    return authService.resumeSession();
                })()
            );

            const result = await authCtx.pendingInit;
            authCtx.pendingInit = null;

            return result;
        },
        /**
         * Consumes a session fork request and sends response.
         * Reset api in case it was in an invalid session state.
         * to see full data flow : `applications/account/src/app/content/PublicApp.tsx`
         */
        consumeFork: withContext(async (ctx, data) => {
            api.configure();

            try {
                ctx.setStatus(WorkerStatus.AUTHORIZING);

                const { keyPassword } = data;
                const result = await consumeFork({ api, ...data });

                const { AccessToken, RefreshToken } = result;

                await Promise.all([
                    persistSession(api, result),
                    authService.login({
                        UID: result.UID,
                        AccessToken,
                        RefreshToken,
                        keyPassword,
                    }),
                ]);

                /* if we get a locked session error on user/access we should not
                show a login error : user will have to unlock */
                await api({ url: `pass/v1/user/access`, method: 'post' }).catch((e) => {
                    if (e.name !== 'LockedSession') {
                        throw e;
                    }
                });

                return {
                    payload: {
                        title: c('Title').t`Welcome to ${PASS_APP_NAME}`,
                        message: c('Info')
                            .t`More than a password manager, ${PASS_APP_NAME} protects your password and your personal email address via email aliases. Powered by the same technology behind ${MAIL_APP_NAME}, your data is end to end encrypted and is only accessible by you.`,
                    },
                };
            } catch (error: any) {
                ctx.setStatus(WorkerStatus.UNAUTHORIZED);
                throw {
                    payload: {
                        title: error.title ?? c('Error').t`Something went wrong`,
                        message: error.message ?? c('Warning').t`Unable to login to ${PASS_APP_NAME}`,
                    },
                };
            }
        }),

        login: withContext(async (ctx, options) => {
            const { UID, keyPassword, AccessToken, RefreshToken } = options;
            await browserSessionStorage.setItems({ UID, keyPassword, AccessToken, RefreshToken });

            api.configure({ UID, AccessToken, RefreshToken });
            api.unsubscribe();

            authService.authStore.setUID(UID);
            authService.authStore.setPassword(keyPassword);

            const cachedLockStatus = authCtx.lockStatus;
            const lock = cachedLockStatus ? { status: cachedLockStatus } : await checkSessionLock();

            if (lock.status === SessionLockStatus.LOCKED) {
                logger.info(`[Worker::Auth] Detected locked session`);

                authService.lock();
                return false;
            }

            if (lock.status === SessionLockStatus.REGISTERED && lock.ttl) {
                logger.info(`[Worker::Auth] Detected a registered session lock`);
                store.dispatch(sessionLockSync({ ttl: lock.ttl }));
            }

            api.subscribe((event) => {
                switch (event.type) {
                    case 'session': {
                        api.unsubscribe();

                        /* inactive session means user needs to log back in */
                        if (event.status === 'inactive') {
                            store.dispatch(
                                notification({
                                    type: 'error',
                                    text: c('Warning').t`Please log back in`,
                                })
                            );

                            return store.dispatch(signout({ soft: false }));
                        }

                        /* locked session means user needs to enter PIN */
                        if (event.status === 'locked') {
                            authService.lock();

                            store.dispatch(
                                notification({
                                    type: 'error',
                                    text: c('Warning').t`Your session was locked due to inactivity`,
                                })
                            );

                            return;
                        }
                    }
                    case 'error': {
                    }
                }
            });

            logger.info(`[Worker::Auth] User is authorized`);
            ctx.setStatus(WorkerStatus.AUTHORIZED);
            onAuthorized?.();

            return true;
        }),

        logout: withContext((ctx) => {
            authService.authStore.setUID(undefined);
            authService.authStore.setPassword(undefined);

            api.unsubscribe();
            api.configure();

            ctx.setStatus(WorkerStatus.UNAUTHORIZED);
            onUnauthorized?.();

            return true;
        }),

        resumeSession: withContext(async (ctx) => {
            logger.info(`[Worker::Auth] Trying to resume session`);
            ctx.setStatus(WorkerStatus.RESUMING);

            const persistedSession = await getPersistedSession();

            if (persistedSession) {
                try {
                    /**
                     * Resuming session will most likely happen on browser
                     * start-up before the API has a chance to be configured
                     * through the auth service -> make sure to configure it
                     * with the persisted session authentication parameters
                     * in order for the underlying API calls to succeed and
                     * handle potential token refreshing (ie: persisted access token
                     * expired)
                     */
                    api.configure({
                        UID: persistedSession.UID,
                        AccessToken: persistedSession.AccessToken,
                        RefreshToken: persistedSession.RefreshToken,
                    });

                    const session = await resumeSession({ session: persistedSession, api });

                    if (session !== undefined) {
                        logger.info(`[Worker::Auth] Session successfuly resumed`);
                        return await authService.login(session);
                    }
                } catch (e) {
                    ctx.setStatus(WorkerStatus.RESUMING_FAILED);
                    const description = e instanceof Error ? getApiErrorMessage(e) ?? e?.message : '';

                    store.dispatch(
                        notification({
                            type: 'error',
                            text: c('Error').t`Could not resume your session : ${description}`,
                        })
                    );

                    return false;
                }
            }

            ctx.setStatus(WorkerStatus.UNAUTHORIZED);
            return false;
        }),
    };

    WorkerMessageBroker.registerMessage(WorkerMessageType.FORK, withPayload(authService.consumeFork));
    WorkerMessageBroker.registerMessage(WorkerMessageType.RESUME_SESSION_SUCCESS, withPayload(authService.login));

    return authService;
};
