import { LAYOUT } from "./config.js";

const MIN_FONT_SIZE = 12;
const HORIZONTAL_PADDING = 12;
const RAMP_ICON_SPACE = 20;
const ETC_ICON_SPACE = 25;

export function fitSvgLabels(svg) {
    const labels = svg.querySelectorAll(
        ".facility-label-text, .structure-label-text"
    );

    labels.forEach(text => {
        const group = text.parentElement;
        const hasRampIcon = Boolean(
            group?.querySelector(".facility-ramp-icon")
        );
        const hasEtcIcon = Boolean(
            group?.querySelector(".facility-etc-icon")
        );
        const availableWidth = LAYOUT.labelWidth
            - HORIZONTAL_PADDING
            - (hasRampIcon ? RAMP_ICON_SPACE : 0)
            - (hasEtcIcon ? ETC_ICON_SPACE : 0);

        text.setAttribute("font-size", LAYOUT.labelFontSize);
        text.removeAttribute("textLength");
        text.removeAttribute("lengthAdjust");

        const measuredWidth = text.getComputedTextLength();
        if (!measuredWidth || measuredWidth <= availableWidth) return;

        const fittedFontSize = Math.max(
            MIN_FONT_SIZE,
            LAYOUT.labelFontSize * availableWidth / measuredWidth
        );
        text.setAttribute("font-size", fittedFontSize.toFixed(2));

        const resizedWidth = text.getComputedTextLength();
        if (resizedWidth > availableWidth) {
            text.setAttribute("textLength", availableWidth);
            text.setAttribute("lengthAdjust", "spacingAndGlyphs");
        }
    });
}
