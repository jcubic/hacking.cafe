const COLORS = {
    blue:   '#55f',
    green:  '#4d4',
    grey:   '#999',
    red:    '#A00',
    yellow: '#FF5',
    violet: '#a320ce',
    white:  '#fff',
    'persian-green': '#0aa'
} as const;

export type COLOR = keyof typeof COLORS;

function is_color(color: any): color is COLOR {
    return Object.hasOwn(COLORS, color);
}

export function color(name: string, string: string) {
    if (is_color(name)) {
        return '[[;' + COLORS[name] + ';]' + string + ']';
    } else {
        return string;
    }
}
