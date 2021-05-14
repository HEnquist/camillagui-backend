export type Path = (string|number)[]

export interface ErrorsForPath{
    (p: {path: Path, includeChildren?: boolean}): string | undefined
}

export const noErrors: ErrorsForPath =
    () => undefined

export function errorsOf(errorList: Array<[Path, string]>): ErrorsForPath {
    return (p :{path: Path, includeChildren?: boolean}): string | undefined => {
        const {path, includeChildren} = p
        const filter = includeChildren ?
            (item: Path) => startsWith(item, path)
            : (item: Path) => equals(item, path)
        const text = errorList
            .filter(entry => filter(entry[0]))
            .map(entry => entry[1])
            .join('\n')
        return text.length > 0 ? text : undefined
    }
}

function equals(a1: Path, a2: Path) {
    if (a1.length !== a2.length)
        return false
    for (let i = 0, l=a2.length; i < l; i++)
        if (a1[i] !== a2[i])
            return false
    return true
}

function startsWith(path: Path, prefix: Path) {
    if (path.length < prefix.length)
        return false
    for (let i = 0, l=prefix.length; i < l; i++)
        if (path[i] !== prefix[i])
            return false
    return true
}

export function errorsForSubpath(errors: ErrorsForPath, ...prefix: Path): ErrorsForPath {
    return (p :{path: Path, includeChildren?: boolean}): string | undefined => {
        return errors({path: prefix.concat(p.path), includeChildren: p.includeChildren})
    }
}