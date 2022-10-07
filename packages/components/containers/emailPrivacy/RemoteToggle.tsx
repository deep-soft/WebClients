import { c } from 'ttag';

import { updateShowImages } from '@proton/shared/lib/api/mailSettings';
import { SHOW_IMAGES } from '@proton/shared/lib/constants';

import { Toggle } from '../../components';
import { useApi, useEventManager, useLoading, useNotifications, useToggle } from '../../hooks';

interface Props {
    id: string;
    hideRemoteImages: number;
    onChange: (value: number) => void;
}

const RemoteToggle = ({ id, hideRemoteImages, onChange, ...rest }: Props) => {
    const [loading, withLoading] = useLoading();
    const { createNotification } = useNotifications();
    const { call } = useEventManager();
    const api = useApi();
    const { state, toggle } = useToggle(hideRemoteImages === SHOW_IMAGES.SHOW);

    const handleChange = async (checked: boolean) => {
        const bit = checked ? SHOW_IMAGES.SHOW : SHOW_IMAGES.HIDE;
        await api(updateShowImages(bit)); // TODO
        await call();
        toggle();
        onChange(bit);
        createNotification({ text: c('Success').t`Preference saved` });
    };
    return (
        <Toggle
            id={id}
            checked={state}
            onChange={({ target }) => withLoading(handleChange(target.checked))}
            loading={loading}
            {...rest}
        />
    );
};

export default RemoteToggle;
