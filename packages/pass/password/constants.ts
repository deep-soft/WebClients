/* We've removed the characters `i, o, l, I ,O ,L`  to minimize
 * the chance of confusion. For symbols we'd like to avoid those
 * that prevent selecting the password when double clicking on
 * top of the password. */
export const uppercaseChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const lowercaseChars = 'abcdefghijklmnopqrstuvwxyz';
export const digitChars = '0123456789';
export const specialChars = '!#$%&()*+.:;<=>?@[]^';

export const DEFAULT_PASSWORD_LENGTH = 16;
