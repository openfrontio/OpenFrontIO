/* eslint-disable @typescript-eslint/no-unsafe-assignment */
export default {
  create(context) {
    return {
      CallExpression(node) {
        if (
          node.callee.type === "MemberExpression" &&
          node.callee.object.name === "z" &&
          node.callee.property.name === "array" &&
          node.arguments.length === 1
        ) {
          const argSource = context.sourceCode.getText(node.arguments[0]);
          context.report({
            data: { type: argSource },
            fix(fixer) {
              return fixer.replaceText(node, `${argSource}.array()`);
            },
            messageId: "noZArray",
            node,
          });
        }
      },
    };
  },
  meta: {
    docs: {
      description: "Disallow z.array(type) in favor of type.array()",
    },
    fixable: "code",
    messages: {
      noZArray: "Use `{{type}}.array()` instead of `z.array({{type}})`.",
    },
    schema: [],
    type: "suggestion",
  },
};
