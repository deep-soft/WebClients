import { type FC } from 'react';

import { Behaviors } from 'proton-pass-extension/lib/components/Settings/Behaviors';

import { ApplicationLogs } from '@proton/pass/components/Settings/ApplicationLogs';
import { Locale } from '@proton/pass/components/Settings/Locale';

export const General: FC = () => [<Locale />, <Behaviors />, <ApplicationLogs style={{ '--h-custom': '18.75rem' }} />];
