import { isEqual } from "lodash"

export type Path = (string|number)[]
export type Error = [Path, string] // Path in config + error message

export class Errors {

    private errors: Array<Error>

    constructor(errors: Array<Error> = []) {
        this.errors = errors
    }

    hasErrors(): boolean {
        return this.errors.length > 0
    }

    hasErrorsFor(...path: Path) {
        return this.forSubpath(...path).hasErrors()
    }

    forSubpath(...prefix: Path): Errors {
        if (prefix.length === 0)
            return this
        return new Errors(
            this.errors.filter(([path, _]) => path.length > 0 && path[0] === prefix[0])
                .map(([path, message]) => [path.slice(1), message])
        ).forSubpath(...prefix.slice(1))
    }

    rootMessage(): string | undefined {
        const messages = this.errors.filter(([path, _]) => isEqual(path, []))
            .map(([_, message]) => message);
        return messages.length === 0 ?
            undefined
            : messages.join('\n')
    }

    messageFor(...path: Path): string | undefined {
        return this.forSubpath(...path).rootMessage()
    }

    asText(): string {
        return this.errors.map(error => this.formattedError(error))
            .join('\n')
    }

    private formattedError(error: Error): string {
        const [path, message] = error
        const formattedPath = path.length === 0 ? '' : path.join('|') + ": "
        return formattedPath + message
    }
}

export const NoErrors = new Errors()