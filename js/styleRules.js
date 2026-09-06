import { COLORS } from "./config.js";

export function getLabelStyle(item) {
    if (item.kind === "facility") {
        return getFacilityLabelStyle(item);
    }

    if (item.kind === "structure") {
        return getStructureLabelStyle(item);
    }

    return {
        fill: COLORS.labelFill,
        stroke: COLORS.labelStroke,
        text: "#000000"
    };
}

function getFacilityLabelStyle(facility) {
    switch (facility.type) {
        case "IC":
            return {
                fill: COLORS.icsaGreen,
                stroke: COLORS.icsaGreen,
                text: COLORS.icsaWhite
            };

        case "JCT":
        case "JCT_IC":
            return {
                fill: COLORS.icsaGreen,
                stroke: COLORS.icsaGreen,
                text: COLORS.icsaWhite
            };

        case "SA":
        case "PA":
            return {
                fill: COLORS.icsaWhite,
                stroke: COLORS.icsaGreen,
                text: COLORS.icsaGreen
            };

        case "SIC":
            return {
                fill: COLORS.sicPurple,
                stroke: COLORS.sicPurple,
                text: COLORS.icsaWhite
            };

        default:
            return {
                fill: COLORS.labelFill,
                stroke: COLORS.labelStroke,
                text: "#000000"
            };
    }
}

function getStructureLabelStyle(structure) {
    switch (structure.type) {
        case "BRIDGE":
            return {
                fill: COLORS.bridgeLabel,
                stroke: "#000000",
                text: "#000000"
            };

        case "TUNNEL":
            return {
                fill: "#1E88E5",
                stroke: "#0D47A1",
                text: COLORS.labelText
            };

        default:
            return {
                fill: COLORS.labelFill,
                stroke: COLORS.labelStroke,
                text: "#000000"
            };
    }
}
