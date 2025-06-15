import t from "@babel/types";

/*TODO: 
  Optimise this plugin to use a single pass, 
  for now I'm not confident if this is consistent 
  enough to work reliably in a single pass, so it 
  uses two passes.
*/

// --- New Key Extraction Plugin ---
export const findAndExtractKeyPlugin = (api) => {
  return {
    visitor: {
      Program(programPath) {
        const FIND_ALL_CANDIDATES = true; //? Set to false to stop at the first valid key
        console.time("Key Extraction Time");

        let potentialKeyArrays = {};
        let foundKeys = [];
        let nonHexCandidates = [];
        let wrongLengthCandidates = [];

        const arrayCollectorVisitor = {
          VariableDeclarator(path) {
            if (
              t.isIdentifier(path.node.id) &&
              t.isArrayExpression(path.node.init)
            ) {
              const arrayName = path.node.id.name;
              const elements = path.node.init.elements.map((el) => {
                if (t.isStringLiteral(el)) return el.value;
                if (t.isNumericLiteral(el)) return el.value;
                return null; // Mark non-literal elements
              });
              // Only store if all elements are simple literals
              if (elements.every((el) => el !== null)) {
                potentialKeyArrays[arrayName] = elements;
              }
            }
          },
          AssignmentExpression(path) {
            if (
              t.isIdentifier(path.node.left) &&
              t.isArrayExpression(path.node.right)
            ) {
              const arrayName = path.node.left.name;
              const elements = path.node.right.elements.map((el) => {
                if (t.isStringLiteral(el)) return el.value;
                if (t.isNumericLiteral(el)) return el.value;
                return null; // Mark non-literal elements
              });
              // Only store if all elements are simple literals
              if (elements.every((el) => el !== null)) {
                potentialKeyArrays[arrayName] = elements;
              }
            }
          },
        };

        programPath.traverse(arrayCollectorVisitor);

        // Define the visitor for the second pass (finding map/join patterns)
        const keyFinderVisitor = {
          CallExpression(path) {
            const calleeProperty = path.node.callee.property;
            const isJoinCall =
              t.isMemberExpression(path.node.callee) &&
              (t.isIdentifier(calleeProperty, { name: "join" }) ||
                (t.isStringLiteral(calleeProperty) &&
                  calleeProperty.value === "join")) &&
              (path.node.arguments.length === 0 ||
                (path.node.arguments.length === 1 &&
                  t.isStringLiteral(path.node.arguments[0]) &&
                  path.node.arguments[0].value === ""));

            if (isJoinCall) {
              const joinObject = path.node.callee.object;

              const joinObjectCalleeProperty =
                joinObject.callee && joinObject.callee.property;
              const isMapCall =
                t.isCallExpression(joinObject) &&
                t.isMemberExpression(joinObject.callee) &&
                (t.isIdentifier(joinObjectCalleeProperty, { name: "map" }) ||
                  (t.isStringLiteral(joinObjectCalleeProperty) &&
                    joinObjectCalleeProperty.value === "map")) &&
                joinObject.arguments.length === 1 &&
                t.isArrowFunctionExpression(joinObject.arguments[0]);

              if (isMapCall) {
                const mapCallback = joinObject.arguments[0];
                const mapArrayIdentifier = joinObject.callee.object;

                if (
                  !t.isIdentifier(mapArrayIdentifier) ||
                  !potentialKeyArrays[mapArrayIdentifier.name]
                ) {
                  return;
                }
                const indexArrayName = mapArrayIdentifier.name;
                const indexArray = potentialKeyArrays[indexArrayName];

                if (
                  mapCallback.params.length === 1 &&
                  t.isIdentifier(mapCallback.params[0])
                ) {
                  const callbackParamName = mapCallback.params[0].name;
                  let stringArrayName = null;

                  const mapCallbackNode = mapCallback;

                  if (t.isArrowFunctionExpression(mapCallbackNode)) {
                    const bodyNode = mapCallbackNode.body;
                    if (t.isBlockStatement(bodyNode)) {
                      const mapCallbackBodyPath = path.get(
                        "callee.object.arguments.0.body"
                      );
                      if (mapCallbackBodyPath) {
                        mapCallbackBodyPath.traverse({
                          ReturnStatement(returnPath) {
                            const arg = returnPath.node.argument;
                            if (
                              t.isMemberExpression(arg) &&
                              t.isIdentifier(arg.object) &&
                              t.isIdentifier(arg.property, {
                                name: callbackParamName,
                              }) &&
                              arg.computed
                            ) {
                              stringArrayName = arg.object.name;
                              returnPath.stop();
                            }
                          },
                        });
                      }
                    } else if (t.isMemberExpression(bodyNode)) {
                      if (
                        t.isIdentifier(bodyNode.object) &&
                        t.isIdentifier(bodyNode.property, {
                          name: callbackParamName,
                        }) &&
                        bodyNode.computed
                      ) {
                        stringArrayName = bodyNode.object.name;
                      }
                    }
                  }

                  if (stringArrayName && potentialKeyArrays[stringArrayName]) {
                    const stringArray = potentialKeyArrays[stringArrayName];

                    try {
                      const result = indexArray
                        .map((index) => stringArray[index])
                        .join("");

                      const isHex = /^[0-9a-fA-F]*$/.test(result);

                      if (result.length === 64) {
                        if (isHex) {
                          foundKeys.push({
                            key: result,
                            stringArrayName,
                            indexArrayName,
                            stringArray: [...stringArray],
                            indexArray: [...indexArray],
                          });
                          if (!FIND_ALL_CANDIDATES) {
                            path.stop(); // Stop traversal if we only want the first key
                          }
                        } else {
                          nonHexCandidates.push({
                            result,
                            stringArrayName,
                            indexArrayName,
                          });
                        }
                      } else {
                        wrongLengthCandidates.push({
                          result,
                          stringArrayName,
                          indexArrayName,
                          length: result.length,
                        });
                      }
                    } catch (e) {
                      console.error("Error during key derivation:", e);
                    }
                  }
                }
              }
            }
          },
        };

        // Second pass: look for the map().join('') pattern
        programPath.traverse(keyFinderVisitor);

        if (foundKeys.length > 0) {
          if (FIND_ALL_CANDIDATES) {
            console.log(
              `--- Found ${foundKeys.length} Potential AES Key(s) ---`
            );
            foundKeys.forEach((item, idx) => {
              console.log(`
--- Candidate Key ${idx + 1} ---`);
              console.log("Derived Key:", item.key);
              console.log("String Array Name:", item.stringArrayName);
              console.log(
                "String Array Content:",
                JSON.stringify(item.stringArray)
              );
              console.log("Index Array Name:", item.indexArrayName);
              console.log(
                "Index Array Content:",
                JSON.stringify(item.indexArray)
              );
            });
          } else {
            // Only one key was sought and found
            const item = foundKeys[0];
            console.log(`
--- Found AES Key ---`);
            console.log("Derived Key:", item.key);
            console.log("String Array Name:", item.stringArrayName);
            console.log(
              "String Array Content:",
              JSON.stringify(item.stringArray)
            );
            console.log("Index Array Name:", item.indexArrayName);
            console.log(
              "Index Array Content:",
              JSON.stringify(item.indexArray)
            );
          }
        } else {
          console.log("--- AES Key Not Found ---");
          console.log("\n--- Debugging Information ---");
          console.log(
            `Total potential source arrays identified: ${
              Object.keys(potentialKeyArrays).length
            }`
          );

          if (nonHexCandidates.length > 0) {
            console.log(`
    Found ${nonHexCandidates.length} candidate string(s) that were 64 characters but not valid hex:`);
            nonHexCandidates.forEach((cand) => {
              console.log(
                `  - From arrays '${cand.stringArrayName}' and '${cand.indexArrayName}': "${cand.result}"`
              );
            });
          } else {
            console.log(
              "\nNo 64-character strings were found that failed hex validation."
            );
          }

          if (wrongLengthCandidates.length > 0) {
            console.log(`
    Found ${wrongLengthCandidates.length} string(s) from map/join patterns that were not 64 characters long:`);
            wrongLengthCandidates.forEach((cand) => {
              console.log(
                `  - From arrays '${cand.stringArrayName}' and '${cand.indexArrayName}': "${cand.result}" (Length: ${cand.length})`
              );
            });
          } else {
            console.log(
              "\nNo strings from map/join patterns were found with incorrect lengths."
            );
          }
        }
        console.timeEnd("Key Extraction Time");
      },
    },
  };
};
