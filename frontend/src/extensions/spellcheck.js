import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const spellcheckPluginKey = new PluginKey("spellcheck");

function normalizeOccurrences(errors) {
  if (!Array.isArray(errors)) {
    return [];
  }

  return errors
    .filter((item) => {
      return (
        typeof item?.id === "string" &&
        typeof item?.from === "number" &&
        typeof item?.to === "number" &&
        typeof item?.wrong === "string" &&
        typeof item?.correct === "string" &&
        item.to > item.from
      );
    })
    .map((item) => ({
      id: item.id,
      from: item.from,
      to: item.to,
      wrong: item.wrong,
      correct: item.correct
    }));
}

function buildDecorationSet(doc, errors) {
  const occurrences = normalizeOccurrences(errors).filter((item) => {
    return item.from >= 1 && item.to <= doc.content.size;
  });

  const decorations = occurrences.map((item) =>
    Decoration.inline(
      item.from,
      item.to,
      {
        class: "spell-error",
        "data-spell-id": item.id
      },
      item
    )
  );

  return {
    errors: occurrences,
    decorations: DecorationSet.create(doc, decorations)
  };
}

function mapPluginState(transaction, pluginState) {
  const mappedDecorations = pluginState.decorations.map(transaction.mapping, transaction.doc);
  const mappedErrors = mappedDecorations.find().map((decoration) => ({
    id: decoration.spec.id,
    wrong: decoration.spec.wrong,
    correct: decoration.spec.correct,
    from: decoration.from,
    to: decoration.to
  }));

  return {
    errors: mappedErrors,
    decorations: mappedDecorations
  };
}

const SpellcheckExtension = Extension.create({
  name: "spellcheck",

  addOptions() {
    return {
      onWordContextMenu: null
    };
  },

  addCommands() {
    return {
      setSpellErrors:
        (errors) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            dispatch(tr.setMeta(spellcheckPluginKey, { type: "setErrors", errors }));
          }

          return true;
        },

      clearSpellErrors:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            dispatch(tr.setMeta(spellcheckPluginKey, { type: "clearErrors" }));
          }

          return true;
        },

      applySpellSuggestion:
        ({ id, from, to, correct }) =>
        ({ state, dispatch }) => {
          if (typeof id !== "string" || typeof correct !== "string") {
            return false;
          }

          if (typeof from !== "number" || typeof to !== "number" || to <= from) {
            return false;
          }

          if (dispatch) {
            const tr = state.tr.insertText(correct, from, to);
            tr.setMeta(spellcheckPluginKey, { type: "applySuggestion", id });
            dispatch(tr);
          }

          return true;
        }
    };
  },

  addProseMirrorPlugins() {
    const onWordContextMenu = this.options.onWordContextMenu;

    return [
      new Plugin({
        key: spellcheckPluginKey,

        state: {
          init() {
            return {
              errors: [],
              decorations: DecorationSet.empty
            };
          },

          apply(transaction, pluginState) {
            const action = transaction.getMeta(spellcheckPluginKey);

            if (action?.type === "setErrors") {
              return buildDecorationSet(transaction.doc, action.errors);
            }

            if (action?.type === "clearErrors") {
              return {
                errors: [],
                decorations: DecorationSet.empty
              };
            }

            if (action?.type === "applySuggestion") {
              const mappedState = mapPluginState(transaction, pluginState);
              const removedDecoration = mappedState.decorations.find(
                undefined,
                undefined,
                (spec) => spec.id === action.id
              );

              return {
                errors: mappedState.errors.filter((item) => item.id !== action.id),
                decorations: removedDecoration.length
                  ? mappedState.decorations.remove(removedDecoration)
                  : mappedState.decorations
              };
            }

            if (transaction.docChanged) {
              return mapPluginState(transaction, pluginState);
            }

            return pluginState;
          }
        },

        props: {
          decorations(state) {
            return spellcheckPluginKey.getState(state)?.decorations || DecorationSet.empty;
          },

          handleDOMEvents: {
            contextmenu(view, event) {
              const target = event.target;

              if (!(target instanceof Element)) {
                return false;
              }

              const errorElement = target.closest(".spell-error");

              if (!errorElement) {
                return false;
              }

              const errorId = errorElement.getAttribute("data-spell-id");

              if (!errorId) {
                return false;
              }

              const pluginState = spellcheckPluginKey.getState(view.state);
              const error = pluginState?.errors.find((item) => item.id === errorId);

              if (!error || typeof onWordContextMenu !== "function") {
                return false;
              }

              event.preventDefault();

              onWordContextMenu({
                id: error.id,
                wrong: error.wrong,
                correct: error.correct,
                from: error.from,
                to: error.to,
                clientX: event.clientX,
                clientY: event.clientY
              });

              return true;
            }
          }
        }
      })
    ];
  }
});

export default SpellcheckExtension;
