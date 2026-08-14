"""Small text-normalization helpers shared across apps."""


def capitalize_first(value: str) -> str:
    """Uppercase only the first character, leaving the rest untouched.

    Deliberately not str.title()/str.capitalize(): those mangle names that
    already have internal capitals or particles (McDonald -> Mcdonald,
    AlSayed -> Alsayed). This only fixes a value that starts lowercase;
    anything already correctly cased is left alone.
    """
    return value[:1].upper() + value[1:] if value else value
