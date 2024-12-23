import { MAX_USERNAME_LENGTH, MIN_USERNAME_LENGTH } from "../Util";

export function validateUsername(username: string): { isValid: boolean; error?: string } {
    const validPattern = /^[a-zA-Z0-9_]+$/; // Alphanumeric and underscores

    if (typeof username !== 'string') {
        return { isValid: false, error: "Username must be a string." };
    }

    if (username.length < MIN_USERNAME_LENGTH) {
        return {
            isValid: false,
            error: `Username must be at least ${MIN_USERNAME_LENGTH} characters long.`,
        };
    }

    if (username.length > MAX_USERNAME_LENGTH) {
        return {
            isValid: false,
            error: `Username must not exceed ${MAX_USERNAME_LENGTH} characters.`,
        };
    }

    if (!validPattern.test(username)) {
        return {
            isValid: false,
            error: "Username can only contain letters, numbers, and underscores.",
        };
    }

    // All checks passed
    return { isValid: true };
}
