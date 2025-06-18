/**
 * Refactored Key Extraction Plugin
 *
 * This plugin extracts AES keys from obfuscated JavaScript code using multiple patterns:
 * - Array.join() patterns
 * - String.fromCharCode() patterns
 * - Concatenated function calls
 * - Indexed array mapping
 *
 * The plugin is organized into modular components for better maintainability.
 */

import { debugLoggers } from "../config/debug.js";
import { ArrayCollector } from "../collectors/arrayCollector.js";
import { SegmentFunctionCollector } from "../collectors/segmentFunctionCollector.js";
import { ArrayJoinExtractor } from "../extractors/arrayJoinExtractor.js";
import { FunctionKeyExtractor } from "../extractors/functionKeyExtractor.js";
import {
  printResults,
  createExtractionSummary,
} from "../utils/extractionUtils.js";
import { debug } from "../../centralDebug.js";
/**
 * Logs the results of the collection phases
 */
function logCollectionResults(segmentFunctionsMap, potentialKeyArrays) {
  const assemblerDebug = debugLoggers.assemblerLogic;
  const arrayDebug = debugLoggers.arrayJoin;

  debug.log("\n--- Collection Phase Results ---");

  const mapKeys = Object.keys(segmentFunctionsMap);
  debug.log(`Segment functions collected: ${mapKeys.length}`);

  if (mapKeys.length > 0) {
    assemblerDebug.log("Available segment keys:", mapKeys.join(", "));
  } else {
    debug.log("No segment functions available for key extraction.");
  }

  const arrayKeys = Object.keys(potentialKeyArrays);
  debug.log(`Potential key arrays collected: ${arrayKeys.length}`);

  if (arrayKeys.length > 0) {
    arrayDebug.log("Available array keys:", arrayKeys.join(", "));
  }
}

/**
 * Main Key Extraction Plugin
 * @param {Object} api - Babel API object
 * @returns {Object} Babel plugin configuration
 */
export const findAndExtractKeyPlugin = (api) => {
  const { types: t } = api;
  const FIND_ALL_CANDIDATES = true;

  return {
    visitor: {
      Program(programPath) {
        const performanceLogger = debugLoggers.performance;
        performanceLogger.time("Key Extraction Time");

        // Initialize result containers
        let foundKeys = [];
        let nonHexCandidates = [];
        let wrongLengthCandidates = [];

        // PASS 1: Collect array literals
        debug.log("Starting Pass 1: Array Collection...");
        const arrayCollector = new ArrayCollector();
        arrayCollector.setTypes(t);
        programPath.traverse(arrayCollector.createVisitor());
        const potentialKeyArrays = arrayCollector.getArrays();

        // PASS 2: Collect segment functions
        debug.log("Starting Pass 2: Segment Function Collection...");
        const segmentFunctionCollector = new SegmentFunctionCollector();
        segmentFunctionCollector.setTypes(t);
        programPath.traverse(segmentFunctionCollector.createVisitor());
        const segmentFunctionsMap = segmentFunctionCollector.getFunctions();

        // Handle special case for variable declarations followed by assignments
        // This logic is now integrated into SegmentFunctionCollector

        // Debug: Print collection results
        logCollectionResults(segmentFunctionsMap, potentialKeyArrays);

        // PASS 3: Extract keys using various patterns
        debug.log("Starting Pass 3: Key Extraction...");

        // --- New: Track object property assignments and aliases for edge-case key extraction ---
        const objectPropertiesMap = {};
        const aliasMap = {}; // Map for S = b3 type aliases

        programPath.traverse({
          VariableDeclarator(path) {
            const t = api.types;
            // Handle S = b3 (alias)
            if (
              t.isIdentifier(path.node.id) &&
              t.isIdentifier(path.node.init)
            ) {
              aliasMap[path.node.id.name] = path.node.init.name;
              debugLoggers.assemblerLogic.log(
                `Collected alias: ${path.node.id.name} = ${path.node.init.name}`
              );
            }
            // Handle b3 = {} (object initialization)
            else if (
              t.isObjectExpression(path.node.init) &&
              t.isIdentifier(path.node.id)
            ) {
              const objName = path.node.id.name;
              objectPropertiesMap[objName] = objectPropertiesMap[objName] || {};
              for (const prop of path.node.init.properties) {
                if (
                  t.isObjectProperty(prop) &&
                  (t.isStringLiteral(prop.key) || t.isIdentifier(prop.key))
                ) {
                  const propName = t.isStringLiteral(prop.key)
                    ? prop.key.value
                    : prop.key.name;
                  objectPropertiesMap[objName][propName] = prop.value;
                } else if (
                  t.isObjectMethod(prop) &&
                  (t.isStringLiteral(prop.key) || t.isIdentifier(prop.key))
                ) {
                  const propName = t.isStringLiteral(prop.key)
                    ? prop.key.value
                    : prop.key.name;
                  objectPropertiesMap[objName][propName] = prop; // Store the whole method node
                }
              }
              debugLoggers.assemblerLogic.log(
                `Collected object properties for: ${objName}`,
                objectPropertiesMap[objName]
              );
            }
          },
          ExpressionStatement(path) {
            const t = api.types;
            const expr = path.node.expression;
            if (!t.isAssignmentExpression(expr)) return;

            // Handles assignments like b3["b"] = function() {...} or b3.b = function() {...}
            if (
              t.isMemberExpression(expr.left) &&
              t.isIdentifier(expr.left.object) &&
              (t.isStringLiteral(expr.left.property) ||
                t.isIdentifier(expr.left.property))
            ) {
              const objName = expr.left.object.name;
              const propName = t.isStringLiteral(expr.left.property)
                ? expr.left.property.value
                : expr.left.property.name;
              objectPropertiesMap[objName] = objectPropertiesMap[objName] || {};
              objectPropertiesMap[objName][propName] = expr.right;
              debugLoggers.assemblerLogic.log(
                `Collected assigned property: ${objName}.${propName}`
              );
            }
            // Handle S = b3 (alias assignment)
            else if (t.isIdentifier(expr.left) && t.isIdentifier(expr.right)) {
              aliasMap[expr.left.name] = expr.right.name;
              debugLoggers.assemblerLogic.log(
                `Collected alias (assignment): ${expr.left.name} = ${expr.right.name}`
              );
            }
            // Handle b3 = {} (object assignment)
            else if (
              t.isIdentifier(expr.left) &&
              t.isObjectExpression(expr.right)
            ) {
              const objName = expr.left.name;
              objectPropertiesMap[objName] = objectPropertiesMap[objName] || {};
              for (const prop of expr.right.properties) {
                if (
                  t.isObjectProperty(prop) &&
                  (t.isStringLiteral(prop.key) || t.isIdentifier(prop.key))
                ) {
                  const propName = t.isStringLiteral(prop.key)
                    ? prop.key.value
                    : prop.key.name;
                  objectPropertiesMap[objName][propName] = prop.value;
                } else if (
                  t.isObjectMethod(prop) &&
                  (t.isStringLiteral(prop.key) || t.isIdentifier(prop.key))
                ) {
                  const propName = t.isStringLiteral(prop.key)
                    ? prop.key.value
                    : prop.key.name;
                  objectPropertiesMap[objName][propName] = prop; // Store the whole method node
                }
              }
              debugLoggers.assemblerLogic.log(
                `Collected object properties via assignment for: ${objName}`,
                objectPropertiesMap[objName]
              );
            }
          },
        });

        // Initialize extractors
        const arrayJoinExtractor = new ArrayJoinExtractor(potentialKeyArrays);
        arrayJoinExtractor.setTypes(t);
        const functionKeyExtractor = new FunctionKeyExtractor(
          segmentFunctionsMap
        );
        functionKeyExtractor.setTypes(t);
        // Pass the objectPropertiesMap and aliasMap to the concatenated key extractor
        if (functionKeyExtractor.concatenatedExtractor) {
          if (
            functionKeyExtractor.concatenatedExtractor.setObjectPropertiesMap
          ) {
            functionKeyExtractor.concatenatedExtractor.setObjectPropertiesMap(
              objectPropertiesMap
            );
          }
          if (functionKeyExtractor.concatenatedExtractor.setAliasMap) {
            functionKeyExtractor.concatenatedExtractor.setAliasMap(aliasMap);
          }
        }

        // Create combined visitor for key extraction
        const keyExtractionVisitor = {
          // Use enter visitors to catch nested functions/variables
          FunctionDeclaration: {
            enter: functionKeyExtractor.createVisitors(
              foundKeys,
              nonHexCandidates,
              wrongLengthCandidates,
              FIND_ALL_CANDIDATES
            ).FunctionDeclaration,
          },
          VariableDeclarator: {
            enter: functionKeyExtractor.createVisitors(
              foundKeys,
              nonHexCandidates,
              wrongLengthCandidates,
              FIND_ALL_CANDIDATES
            ).VariableDeclarator,
          },
          AssignmentExpression: {
            enter: functionKeyExtractor.createVisitors(
              foundKeys,
              nonHexCandidates,
              wrongLengthCandidates,
              FIND_ALL_CANDIDATES
            ).AssignmentExpression,
          },
          CallExpression: arrayJoinExtractor.createCallExpressionHandler(
            foundKeys,
            nonHexCandidates,
            wrongLengthCandidates,
            FIND_ALL_CANDIDATES
          ),
        };

        // Execute key extraction
        programPath.traverse(keyExtractionVisitor);

        // Print results
        printResults(
          foundKeys,
          nonHexCandidates,
          wrongLengthCandidates,
          FIND_ALL_CANDIDATES
        );

        // Log summary statistics
        const summary = createExtractionSummary(
          foundKeys,
          nonHexCandidates,
          wrongLengthCandidates,
          segmentFunctionsMap,
          potentialKeyArrays
        );

        debugLoggers.performance.log("Extraction Summary:", summary);
        performanceLogger.timeEnd("Key Extraction Time");
      },
    },
  };
};
