/*
 *  Copyright (c) 2026 Jakub T. Jankiewicz <https://jakub.jankiewicz.org>
 *
 *  This file is part of Hacking Cafe.
 *
 *  Hacking Cafe is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU Affero General Public License as published by
 *  the Free Software Foundation; either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  Hacking Cafe is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU Affero General Public License for more details.
 *
 *  You should have received a copy of the GNU Affero General Public License
 *  along with Hacking Cafe.  If not, see <http://www.gnu.org/licenses/>.
 *
 */
function gpu() {
    const offscreen = new OffscreenCanvas(256, 256);
    const gl = offscreen.getContext('webgl') as WebGLRenderingContext;

    let unMaskedInfo = {
        renderer: '',
        vendor: ''
    };

    const dbgRenderInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (dbgRenderInfo != null) {
        unMaskedInfo.renderer = gl.getParameter(dbgRenderInfo.UNMASKED_RENDERER_WEBGL);
        unMaskedInfo.vendor = gl.getParameter(dbgRenderInfo.UNMASKED_VENDOR_WEBGL);
    }

    return unMaskedInfo;
}

export function system_details() {
    // @ts-expect-error
    const OS = navigator.oscpu || navigator.platform;
    // @ts-expect-error
    const browser = navigator.userAgentData && navigator.userAgentData.brands.at(-1);
    return {
        Resolution: `${screen.width}x${screen.height}`,
        Browser: browser ? `${browser.brand} ${browser.version}` : navigator.userAgent,
        OS,
        // @ts-expect-error
        RAM: navigator.deviceMemory ? `${navigator.deviceMemory}GB` : null,
        CPU: `${navigator.hardwareConcurrency} threads`,
        GPU: gpu().renderer,
        Timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        Language: navigator.language
    } as const;
}
