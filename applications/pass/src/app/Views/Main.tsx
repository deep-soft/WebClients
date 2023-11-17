import { type FC } from 'react';

import { Button } from '@proton/atoms/Button';
import { LobbyLayout } from '@proton/pass/components/Layout/Lobby/LobbyLayout';
import { Content } from '@proton/pass/components/Layout/Section/Content';

import { useAuthService } from '../Context/AuthServiceProvider';
import { PrivateRoutes } from './PrivateRoutes';

export const Main: FC = () => {
    const authService = useAuthService();

    return (
        <LobbyLayout overlay>
            <main className="h-full w-full flex flex-column gap-4 flex-align-items-center flex-justify-center">
                <h4>Logged in to Pass</h4>

                <Content>
                    <PrivateRoutes />
                </Content>

                <Button pill shape="solid" color="weak" onClick={() => authService.logout({ soft: false })}>
                    Logout
                </Button>
            </main>
        </LobbyLayout>
    );
};
