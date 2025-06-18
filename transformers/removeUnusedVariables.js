export function removeUnusedVariables({ types: t }) {
  return {
    visitor: {
      Program(programPath) {
        let changed = true;
        while (changed) {
          changed = false;
          programPath.scope.crawl();
          programPath.traverse({
            // Remove unreferenced function declarations
            FunctionDeclaration(path) {
              const binding = path.scope.getBinding(path.node.id.name);
              if (binding && !binding.referenced) {
                path.remove();
                changed = true;
              }
            },
            // Remove unreferenced variable declarators (for functions/vars)
            VariableDeclarator(path) {
              if (t.isIdentifier(path.node.id)) {
                const binding = path.scope.getBinding(path.node.id.name);
                if (binding && !binding.referenced) {
                  path.remove();
                  changed = true;
                }
              }
            },
          });
        }
      },
    },
  };
}
