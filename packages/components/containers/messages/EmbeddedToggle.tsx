import { c } from 'ttag';

import { updateShowImages } from '@proton/shared/lib/api/mailSettings';
import { SHOW_IMAGES } from '@proton/shared/lib/constants';

import { Toggle } from '../../components';
import { useApi, useEventManager, useLoading, useNotifications, useToggle } from '../../hooks';

interface Props {
    id: string;
    hideEmbeddedImages: number;
    onChange: (value: number) => void;
}

const EmbeddedToggle = ({ id, hideEmbeddedImages, onChange }: Props) => {
    const { createNotification } = useNotifications();
    const [loading, withLoading] = useLoading();
    const { call } = useEventManager();
    const api = useApi();
    const { state, toggle } = useToggle(hideEmbeddedImages === SHOW_IMAGES.SHOW);

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
        />
    );
};

export default EmbeddedToggle;
