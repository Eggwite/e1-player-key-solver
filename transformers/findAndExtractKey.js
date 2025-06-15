import t from "@babel/types";

/*TODO: 
  further optimization is challenging with the current robust "collect-then-analyze" approach.
  the current implementation handles two main key extraction patterns:
  1. array.map(callback).join('')
  2. concatenation of calls to simple string-returning functions (e.g., funcA() + funcB())
*/

export const findAndExtractKeyPlugin = (api) => {
  return {
    visitor: {
      Program(programPath) {
        const FIND_ALL_CANDIDATES = false; //? set to false to stop at the first valid key
        console.time("Key Extraction Time");

        let potentialKeyArrays = {};
        let potentialStringFunctions = {};
        let foundKeys = [];
        let nonHexCandidates = [];
        let wrongLengthCandidates = [];
        let callExpressionPathsToProcess = [];

        // helper: collect string-returning function
        function collectFunctionIfStringReturning(idPath, funcPath) {
          if (!idPath || !idPath.isIdentifier() || !funcPath) return;
          const funcName = idPath.node.name;
          const bodyPath = funcPath.get("body");
          let firstStringReturnArgumentPath = null;

          if (bodyPath.isStringLiteral()) {
            // handles concise arrow: () => "string"
            firstStringReturnArgumentPath = bodyPath;
          } else if (bodyPath.isBlockStatement()) {
            // handles block body: () => { ... } or function() { ... }
            bodyPath.traverse({
              ReturnStatement(returnPath) {
                if (firstStringReturnArgumentPath) {
                  // already found one, stop searching
                  returnPath.stop();
                  return;
                }
                // check if this ReturnStatement belongs to the funcPath function directly
                // by comparing the function node this return statement is in, with the funcPath node.
                if (returnPath.getFunctionParent().node === funcPath.node) {
                  const argumentPath = returnPath.get("argument");
                  if (argumentPath && argumentPath.isStringLiteral()) {
                    firstStringReturnArgumentPath = argumentPath;
                    returnPath.stop(); // stop after finding the first suitable return
                  }
                }
              },
            });
          }

          if (firstStringReturnArgumentPath) {
            potentialStringFunctions[funcName] = {
              value: firstStringReturnArgumentPath.node.value,
              nodePath: funcPath, // path to the function node itself (e.g., arrowFunctionExpression)
            };
          }
        }

        // helper: resolve property name
        function getResolvedPropertyName(memberExprPath) {
          if (!memberExprPath.isMemberExpression()) {
            return null;
          }
          const propertyPath = memberExprPath.get("property");
          const propertyNode = propertyPath.node;

          if (!memberExprPath.node.computed) {
            // e.g., obj.prop
            if (t.isIdentifier(propertyNode)) {
              return propertyNode.name;
            }
          } else {
            // e.g., obj["prop"] or obj[propVar]
            if (t.isStringLiteral(propertyNode)) {
              return propertyNode.value;
            }
            if (t.isIdentifier(propertyNode)) {
              const binding = propertyPath.scope.getBinding(propertyNode.name);
              // check if it's a constant variable initialized with a string
              if (
                binding &&
                binding.constant &&
                binding.path.isVariableDeclarator()
              ) {
                const initPath = binding.path.get("init");
                if (initPath.isStringLiteral()) {
                  return initPath.node.value;
                }
              }
            }
          }
          return null;
        }

        // helper: build string from binaryExpression
        function buildStringFromBinaryExpression(binaryExprPath) {
          const parts = [];
          let success = true;

          function collect(currentPath) {
            if (!success) return;

            if (currentPath.isBinaryExpression({ operator: "+" })) {
              collect(currentPath.get("left"));
              collect(currentPath.get("right"));
            } else if (currentPath.isCallExpression()) {
              const callee = currentPath.get("callee");
              if (callee.isIdentifier()) {
                const funcName = callee.node.name;
                if (
                  potentialStringFunctions[funcName] &&
                  typeof potentialStringFunctions[funcName].value === "string"
                ) {
                  parts.push(potentialStringFunctions[funcName].value);
                } else {
                  success = false; // function not pre-collected or not returning a string
                }
              } else {
                success = false; // callee is not a simple identifier
              }
            } else if (currentPath.isStringLiteral()) {
              parts.push(currentPath.node.value);
            } else {
              success = false;
            }
          }

          collect(binaryExprPath);

          if (!success || parts.length === 0) {
            return null;
          }
          return parts.join("");
        }

        // helper: process callExpression for key
        // this function encapsulates the logic from the original keyFinderVisitor.CallExpression
        // returns true if processing should stop (e.g., key found and FIND_ALL_CANDIDATES is false)
        function processCallExpressionForKey(path) {
          const calleePath = path.get("callee");
          // try map().join("") pattern
          if (calleePath.isMemberExpression()) {
            const joinName = getResolvedPropertyName(calleePath);
            const isJoinCall =
              joinName === "join" &&
              (path.node.arguments.length === 0 ||
                (path.node.arguments.length === 1 &&
                  t.isStringLiteral(path.node.arguments[0]) &&
                  path.node.arguments[0].value === ""));

            if (isJoinCall) {
              const joinObjectPath = calleePath.get("object");
              if (joinObjectPath.isCallExpression()) {
                const mapCalleePath = joinObjectPath.get("callee");
                if (mapCalleePath.isMemberExpression()) {
                  const mapName = getResolvedPropertyName(mapCalleePath);
                  const mapArguments = joinObjectPath.get("arguments");
                  const isMapCall =
                    mapName === "map" &&
                    mapArguments.length === 1 &&
                    mapArguments[0].isArrowFunctionExpression();

                  if (isMapCall) {
                    const mapCallbackPath = mapArguments[0];
                    const mapCallbackNode = mapCallbackPath.node;
                    const mapArrayIdentifierPath = mapCalleePath.get("object");

                    if (mapArrayIdentifierPath.isIdentifier()) {
                      const mapArrayObjectName =
                        mapArrayIdentifierPath.node.name; // store .name
                      if (potentialKeyArrays[mapArrayObjectName]) {
                        // use stored name
                        const indexArrayName = mapArrayObjectName; // use stored name
                        const indexArray = potentialKeyArrays[indexArrayName];

                        if (
                          mapCallbackNode.params.length === 1 &&
                          t.isIdentifier(mapCallbackNode.params[0])
                        ) {
                          const callbackParamName =
                            mapCallbackNode.params[0].name;
                          let stringArrayName = null;
                          const bodyPath = mapCallbackPath.get("body");

                          if (bodyPath.isBlockStatement()) {
                            bodyPath.traverse({
                              ReturnStatement(returnPath) {
                                const argNode = returnPath.node.argument;
                                if (
                                  t.isMemberExpression(argNode) &&
                                  t.isIdentifier(argNode.object) &&
                                  argNode.computed &&
                                  t.isIdentifier(argNode.property, {
                                    name: callbackParamName,
                                  })
                                ) {
                                  stringArrayName = argNode.object.name;
                                  returnPath.stop();
                                }
                              },
                            });
                          } else if (bodyPath.isMemberExpression()) {
                            const bodyNode = bodyPath.node;
                            if (
                              t.isIdentifier(bodyNode.object) &&
                              bodyNode.computed &&
                              t.isIdentifier(bodyNode.property, {
                                name: callbackParamName,
                              })
                            ) {
                              stringArrayName = bodyNode.object.name;
                            }
                          }

                          if (
                            stringArrayName &&
                            potentialKeyArrays[stringArrayName]
                          ) {
                            const stringArray =
                              potentialKeyArrays[stringArrayName];
                            try {
                              const result = indexArray
                                .map((index) => stringArray[index])
                                .join("");
                              const isHex = /^[0-9a-fA-F]*$/.test(result);
                              if (result.length === 64) {
                                if (isHex) {
                                  foundKeys.push({
                                    key: result,
                                    type: "map-join",
                                    stringArrayName,
                                    indexArrayName,
                                    stringArray: [...stringArray],
                                    indexArray: [...indexArray],
                                  });
                                  if (!FIND_ALL_CANDIDATES) return true;
                                } else {
                                  nonHexCandidates.push({
                                    result,
                                    type: "map-join",
                                    stringArrayName,
                                    indexArrayName,
                                  });
                                }
                              } else {
                                wrongLengthCandidates.push({
                                  result,
                                  type: "map-join",
                                  stringArrayName,
                                  indexArrayName,
                                  length: result.length,
                                });
                              }
                            } catch (e) {
                              console.error(
                                "Error during map-join key derivation:",
                                e
                              );
                            }
                            // if map-join processed, even if not a key, we don't check for concatenation for this specific callExpression
                            return false; // don't stop overall processing unless key found and !FIND_ALL_CANDIDATES
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }

          // try concatenation of function calls pattern
          if (path.node && calleePath.isIdentifier()) {
            const funcName = calleePath.node.name;
            const binding = path.scope.getBinding(funcName);
            let functionNodePath = null;

            if (binding) {
              if (binding.path.isFunctionDeclaration()) {
                functionNodePath = binding.path;
              } else if (binding.path.isVariableDeclarator()) {
                const initPath = binding.path.get("init");
                if (
                  initPath &&
                  (initPath.isFunctionExpression() ||
                    initPath.isArrowFunctionExpression())
                ) {
                  functionNodePath = initPath;
                }
              }
              if (!functionNodePath && binding.constantViolations) {
                for (
                  let i = binding.constantViolations.length - 1;
                  i >= 0;
                  i--
                ) {
                  const violationPath = binding.constantViolations[i];
                  if (
                    violationPath.isAssignmentExpression() &&
                    violationPath.get("left").isIdentifier({ name: funcName })
                  ) {
                    const rightPath = violationPath.get("right");
                    if (
                      rightPath.isFunctionExpression() ||
                      rightPath.isArrowFunctionExpression()
                    ) {
                      functionNodePath = rightPath;
                      break;
                    }
                  }
                }
              }
            }

            if (functionNodePath) {
              const bodyPath = functionNodePath.get("body");
              let returnedValuePath = null;
              if (bodyPath.isExpression()) {
                returnedValuePath = bodyPath;
              } else if (bodyPath.isBlockStatement()) {
                const returnStatements = [];
                bodyPath.traverse({
                  ReturnStatement(returnPath) {
                    if (
                      returnPath.getFunctionParent().node ===
                      functionNodePath.node
                    ) {
                      returnStatements.push(returnPath);
                    }
                  },
                });
                if (returnStatements.length === 1) {
                  returnedValuePath = returnStatements[0].get("argument");
                }
              }

              if (
                returnedValuePath &&
                returnedValuePath.isBinaryExpression({ operator: "+" })
              ) {
                const concatenatedString =
                  buildStringFromBinaryExpression(returnedValuePath);
                if (concatenatedString !== null) {
                  const isHex = /^[0-9a-fA-F]*$/.test(concatenatedString);
                  if (concatenatedString.length === 64) {
                    if (isHex) {
                      const components = [];
                      function getComponentFuncs(binPath) {
                        if (binPath.isBinaryExpression({ operator: "+" })) {
                          getComponentFuncs(binPath.get("left"));
                          getComponentFuncs(binPath.get("right"));
                        } else if (
                          binPath.isCallExpression() &&
                          binPath.get("callee").isIdentifier()
                        ) {
                          components.push(binPath.get("callee").node.name);
                        } else if (binPath.isStringLiteral()) {
                          components.push(`"${binPath.node.value}"`);
                        }
                      }
                      getComponentFuncs(returnedValuePath);
                      foundKeys.push({
                        key: concatenatedString,
                        type: "concatenation",
                        viaFunction: funcName,
                        components: components,
                      });
                      if (!FIND_ALL_CANDIDATES) return true;
                    } else {
                      nonHexCandidates.push({
                        result: concatenatedString,
                        type: "concatenation",
                        viaFunction: funcName,
                      });
                    }
                  } else {
                    wrongLengthCandidates.push({
                      result: concatenatedString,
                      type: "concatenation",
                      viaFunction: funcName,
                      length: concatenatedString.length,
                    });
                  }
                }
              }
            }
          }
          return false; // continue processing other callExpressions
        }

        // single traversal: collect sources and callExpression paths
        programPath.traverse({
          VariableDeclarator(path) {
            const idPath = path.get("id");
            const initPath = path.get("init");
            if (idPath.isIdentifier()) {
              // collect arrays
              if (initPath.isArrayExpression()) {
                const arrayName = idPath.node.name;
                const elements = initPath.node.elements.map((el) => {
                  if (t.isStringLiteral(el)) return el.value;
                  if (t.isNumericLiteral(el)) return el.value;
                  return null;
                });
                if (elements.every((el) => el !== null)) {
                  potentialKeyArrays[arrayName] = elements;
                }
              }
              // collect string-returning functions
              else if (
                initPath.isFunctionExpression() ||
                initPath.isArrowFunctionExpression()
              ) {
                collectFunctionIfStringReturning(idPath, initPath);
              }
            }
          },
          AssignmentExpression(path) {
            const leftPath = path.get("left");
            const rightPath = path.get("right");
            if (leftPath.isIdentifier()) {
              // collect arrays from assignments
              if (rightPath.isArrayExpression()) {
                const arrayName = leftPath.node.name;
                const elements = rightPath.node.elements.map((el) => {
                  if (t.isStringLiteral(el)) return el.value;
                  if (t.isNumericLiteral(el)) return el.value;
                  return null;
                });
                if (elements.every((el) => el !== null)) {
                  potentialKeyArrays[arrayName] = elements;
                }
              }
              // collect string-returning functions from assignments
              else if (
                rightPath.isFunctionExpression() ||
                rightPath.isArrowFunctionExpression()
              ) {
                collectFunctionIfStringReturning(leftPath, rightPath);
              }
            }
          },
          FunctionDeclaration(path) {
            collectFunctionIfStringReturning(path.get("id"), path);
          },
          CallExpression(path) {
            callExpressionPathsToProcess.push(path);
          },
        });

        // second phase: process collected callExpressions
        for (const path of callExpressionPathsToProcess) {
          const shouldStop = processCallExpressionForKey(path);
          if (shouldStop) {
            // true if key found and !FIND_ALL_CANDIDATES
            break;
          }
        }

        // logging results
        if (foundKeys.length > 0) {
          if (FIND_ALL_CANDIDATES) {
            console.log(
              `--- Found ${foundKeys.length} Potential AES Key(s) ---`
            );
            foundKeys.forEach((item, idx) => {
              console.log(`\n--- Candidate Key ${idx + 1} (${item.type}) ---`);
              console.log("Derived Key:", item.key);
              if (item.type === "map-join") {
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
              } else if (item.type === "concatenation") {
                console.log("Constructed via function:", item.viaFunction);
                console.log("Components:", item.components.join(" + "));
              }
            });
          } else {
            const item = foundKeys[0];
            console.log(`\n--- Found AES Key (${item.type}) ---`);
            console.log("Derived Key:", item.key);
            if (item.type === "map-join") {
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
            } else if (item.type === "concatenation") {
              console.log("Constructed via function:", item.viaFunction);
              console.log("Components:", item.components.join(" + "));
            }
          }
        } else {
          console.log("--- AES Key Not Found ---");
        }

        console.log("\n--- Debugging Information ---");
        console.log(
          `Total potential source arrays identified: ${
            Object.keys(potentialKeyArrays).length
          }`
        );
        console.log(
          `Total potential string-returning functions identified: ${
            Object.keys(potentialStringFunctions).length
          }`
        );
        // console.log("potential String Functions:", potentialStringFunctions);

        if (nonHexCandidates.length > 0) {
          console.log(`
    Found ${nonHexCandidates.length} candidate string(s) that were 64 characters but not valid hex:`);
          nonHexCandidates.forEach((cand) => {
            console.log(
              `  - Type '${cand.type}', Result: "${cand.result}" ${
                cand.viaFunction
                  ? "(via " + cand.viaFunction + ")"
                  : `(from arrays '${cand.stringArrayName}' and '${cand.indexArrayName}')`
              }`
            );
          });
        } else {
          console.log(
            "\nNo 64-character strings were found that failed hex validation."
          );
        }

        if (wrongLengthCandidates.length > 0) {
          console.log(`
    Found ${wrongLengthCandidates.length} string(s) from identified patterns that were not 64 characters long:`);
          wrongLengthCandidates.forEach((cand) => {
            console.log(
              `  - Type '${cand.type}', Result: "${cand.result}" (Length: ${
                cand.length
              }) ${
                cand.viaFunction
                  ? "(via " + cand.viaFunction + ")"
                  : `(from arrays '${cand.stringArrayName}' and '${cand.indexArrayName}')`
              }`
            );
          });
        } else {
          console.log(
            "\nNo strings from identified patterns were found with incorrect lengths."
          );
        }
        console.timeEnd("Key Extraction Time");
      },
    },
  };
};
