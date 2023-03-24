import { ComponentProps, useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { FormikContextType, FormikErrors, useFormik } from 'formik';
import { c } from 'ttag';

import { Dropzone, FileInput, onlyDragFiles } from '@proton/components/components';
import { useNotifications } from '@proton/components/hooks';
import { ImportPayload, ImportProvider, ImportReaderPayload, fileReader } from '@proton/pass/import';
import { importItemsIntent, selectRequestStatus } from '@proton/pass/store';
import { importItems } from '@proton/pass/store/actions/requests';
import { Maybe } from '@proton/pass/types';
import { first } from '@proton/pass/utils/array';
import { orThrow, pipe } from '@proton/pass/utils/fp/pipe';
import { isEmptyString } from '@proton/pass/utils/string';
import { splitExtension } from '@proton/shared/lib/helpers/file';
import identity from '@proton/utils/identity';

import { ExtensionContext } from '../extension';

type DropzoneProps = ComponentProps<typeof Dropzone>;
type FileInputProps = ComponentProps<typeof FileInput>;

export type ImportFormValues = { file: Maybe<File>; provider: ImportProvider; passphrase?: string };

export type ImportFormContext = {
    form: FormikContextType<ImportFormValues>;
    reset: () => void;
    busy: boolean;
    dropzone: {
        hovered: boolean;
        onDragEnter: DropzoneProps['onDragEnter'];
        onDragLeave: DropzoneProps['onDragLeave'];
        onDrop: DropzoneProps['onDrop'];
        onAttach: FileInputProps['onChange'];
    };
};

export type UseImportFormBeforeSubmitValue = { ok: true; payload: ImportPayload } | { ok: false };
export type UseImportFormBeforeSubmit = (payload: ImportPayload) => Promise<UseImportFormBeforeSubmitValue>;

export type UseImportFormOptions = {
    beforeSubmit?: UseImportFormBeforeSubmit;
    onImported: () => void;
};

export const SUPPORTED_IMPORT_FILE_TYPES = ['json', '1pux', 'pgp', 'zip', 'csv'];

const createFileValidator = (maxFileSize: number, allow: string[]) =>
    pipe(
        (files: File[]) => first(files)!,
        orThrow('Unsupported file type', (file) => allow.includes(splitExtension(file?.name)[1]), identity),
        orThrow('File too big', (file) => file.size <= maxFileSize, identity)
    );

const getInitialFormValues = (): ImportFormValues => ({
    file: undefined,
    provider: ImportProvider.BITWARDEN,
});

const validateImportForm = ({ provider, file, passphrase }: ImportFormValues): FormikErrors<ImportFormValues> => {
    const errors: FormikErrors<ImportFormValues> = {};

    if (provider === undefined) {
        errors.provider = c('Warning').t`No provider selected`;
    }

    if (file === undefined) {
        errors.file = '';
    }

    if (provider === ImportProvider.PROTONPASS_PGP && isEmptyString(passphrase)) {
        errors.passphrase = c('Warning').t`PGP encrypted export file requires passphrase`;
    }

    return errors;
};

export const useImportForm = ({
    beforeSubmit = (payload) => Promise.resolve({ ok: true, payload }),
    onImported,
}: UseImportFormOptions): ImportFormContext => {
    const dispatch = useDispatch();
    const { endpoint } = ExtensionContext.get();

    const [busy, setBusy] = useState(false);
    const [dropzoneHovered, setDropzoneHovered] = useState(false);
    const { createNotification } = useNotifications();

    const form: FormikContextType<ImportFormValues> = useFormik<ImportFormValues>({
        initialValues: getInitialFormValues(),
        initialErrors: { file: '' },
        validateOnChange: true,
        validateOnMount: true,
        validate: validateImportForm,
        onSubmit: async (values) => {
            try {
                setBusy(true);
                const payload: ImportReaderPayload =
                    values.provider === ImportProvider.PROTONPASS_PGP
                        ? {
                              file: values.file!,
                              provider: values.provider,
                              passphrase: values.passphrase ?? '',
                          }
                        : {
                              file: values.file!,
                              provider: values.provider,
                          };

                const result = await beforeSubmit(await fileReader(payload));

                if (!result.ok) {
                    return setBusy(false);
                }

                dispatch(importItemsIntent({ data: result.payload }, endpoint));
            } catch (e) {
                setBusy(false);
                if (e instanceof Error) {
                    createNotification({ type: 'error', text: e.message });
                }
            }
        },
    });

    const reset = () => {
        form.setValues(getInitialFormValues());
        setBusy(false);
    };

    const onAddFiles = (files: File[]) => {
        try {
            const file = createFileValidator(5 * 1024 * 1024, SUPPORTED_IMPORT_FILE_TYPES)(files);
            form.setValues((values) => ({ ...values, file }));
        } catch (e: any) {
            form.setErrors({ file: e.message });
        }
    };

    const createDragEventHandler: (hover: boolean) => DropzoneProps['onDragEnter' | 'onDragLeave'] = (hover: boolean) =>
        onlyDragFiles((event) => {
            setDropzoneHovered(hover);
            event.stopPropagation();
        });

    const onDrop = onlyDragFiles((event) => {
        event.preventDefault();
        setDropzoneHovered(false);
        onAddFiles([...event.dataTransfer.files]);
    });

    const onAttach: FileInputProps['onChange'] = (event) => onAddFiles((event.target.files as File[] | null) ?? []);

    const requestStatus = useSelector(selectRequestStatus(importItems()));

    useEffect(() => {
        if (requestStatus !== undefined) {
            switch (requestStatus) {
                case 'success': {
                    reset();
                    onImported();
                    break;
                }
                case 'failure': {
                    setBusy(false);
                    break;
                }
            }
        }
    }, [requestStatus]);

    return {
        form,
        reset,
        busy,
        dropzone: {
            hovered: dropzoneHovered,
            onDragEnter: createDragEventHandler(true),
            onDragLeave: createDragEventHandler(false),
            onAttach,
            onDrop,
        },
    };
};
