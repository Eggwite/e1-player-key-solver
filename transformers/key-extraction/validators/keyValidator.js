/**
 * Key validation utilities
 */

/**
 * Validates a potential AES key
 * @param {string} keyString - The key string to validate
 * @param {string} sourceName - Name of the source for debugging
 * @param {string} type - Type of key extraction method
 * @returns {Object|null} Validation result
 */
export function validateKey(keyString, sourceName, type = "unknown") {
  const isHex = /^[0-9a-fA-F]*$/.test(keyString);
  const expectedLength = 64;

  if (keyString.length === expectedLength) {
    if (isHex) {
      return {
        isValidKey: true,
        key: keyString,
        source: sourceName,
        type: type,
      };
    } else {
      return {
        isNonHex: true,
        key: keyString,
        source: sourceName,
        type: type,
      };
    }
  } else {
    return {
      isWrongLength: true,
      key: keyString,
      source: sourceName,
      type: type,
      actualLength: keyString.length,
      expectedLength: expectedLength,
    };
  }
}

/**
 * Validates a concatenated key from function segments
 * @param {string} concatenatedString - The concatenated string
 * @param {string} assemblerFuncName - Name of the assembler function
 * @param {Array} involvedSegmentFuncs - Array of involved segment function names
 * @returns {Object|null} Validation result
 */
export function validateConcatenatedKey(
  concatenatedString,
  assemblerFuncName,
  involvedSegmentFuncs
) {
  if (!concatenatedString) return null;

  const isHex = /^[0-9a-fA-F]*$/.test(concatenatedString);
  const expectedLength = 64;

  if (concatenatedString.length === expectedLength) {
    if (isHex) {
      return {
        isValidKey: true,
        key: concatenatedString,
        segments: involvedSegmentFuncs,
        type: "concatenated_functions",
        source: assemblerFuncName,
      };
    } else {
      return {
        isNonHex: true,
        key: concatenatedString,
        segments: involvedSegmentFuncs,
        type: "concatenated_functions",
        source: assemblerFuncName,
      };
    }
  } else {
    return {
      isWrongLength: true,
      key: concatenatedString,
      segments: involvedSegmentFuncs,
      type: "concatenated_functions",
      source: assemblerFuncName,
      actualLength: concatenatedString.length,
      expectedLength: expectedLength,
    };
  }
}
