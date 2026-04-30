import { Mark } from "@tiptap/core";

export const FontSize = Mark.create({
  name: "fontSize",

  addOptions() {
    return {
      types: ["textStyle"],
    };
  },

  addAttributes() {
    return {
      fontSize: {
        default: null,
        parseHTML: (element) => element.style.fontSize?.replace("px", ""),
        renderHTML: (attributes) => {
          if (!attributes.fontSize) return {};
          return { style: `font-size: ${attributes.fontSize}px` };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span",
        getAttrs: (node) => {
          const fontSize = node.style?.fontSize;
          if (fontSize) return { fontSize: fontSize.replace("px", "") };
          return false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", { style: HTMLAttributes.style }, 0];
  },

  addCommands() {
    return {
      setFontSize:
        (fontSize) =>
        ({ chain }) => {
          return chain()
            .setMark("fontSize", { fontSize })
            .run();
        },
      unsetFontSize:
        () =>
        ({ chain }) => {
          return chain()
            .unsetMark("fontSize")
            .run();
        },
    };
  },
});

export default FontSize;
