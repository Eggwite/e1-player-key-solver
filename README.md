# E1 Player Deobfuscator + Key Extractor Plugin

This project undoes most of the key transformations done to obfuscate the e1-player used on sites like flixhq & hianime.

It wasnt particularly difficult to reverse although neither was the last WASM based implementation, please provide a better challenge in future :3

---

## Deobfuscation Process

The deobfuscation process is handled by the `deobfuscate.js` script, which uses a series of Babel plugins to transform the obfuscated code found in `input.txt`. The output of each pass is written to `output.js`.

### Packages:

 - **Crypto-js** is just used for the `quickDecrypt.js` script. *(optional)*
 - **Babel** is required for the project *(required)*

The process consists of the following passes:

1.  **Normalizing Literals and Unflattening Control Flow:** Simplifies literal representations and straightens out convoluted control flow structures.
2.  **Inlining Arrays and Wrapper Functions:** Replaces references to arrays and wrapper functions with their actual values/code.
3.  **Solving String Array and Solving State Machine:** Resolves the string array (often used to hide strings) and decodes any state machine logic.
4.  **Inlining String Array:** Replaces references to the (now solved) string array with the actual strings.
5.  **Finding and Extracting AES Key:** This pass, implemented in `transformers/findAndExtractKey.js`, automatically locates and derives the AES decryption key. It searches for the pattern where an array is mapped using another array of indices, and the result is joined into a string (e.g., `indexArray.map(n => stringArray[n]).join("")`). If a valid key is found, it's printed to the console.

---

## Manual Key Derivation Steps

The following steps describe the original manual process of deriving the AES key. This process can now be automated by the deobfuscation script (see "Automated Key Derivation" below).

### (1) The getSources request will return an AES CBC ciphertext

`/embed-1/v2/e-1/getSources?id=<XRAX>`

### (2) Then to decrypt it we just locate the ciphertext array and their indexes
![alt text](./images/aes-key-arrays.png)

### (3) Combine them based on those aformentioned indexes e.g.
```js
const r = ["81", "47", "aa6", "1b6", "dda3", "c", "a8", "c29", "90", "326e", "de89", "a", "2e8", "a", "7e50", "fb9", "1f", "1c60", "7", "2", "8", "1", "cd", "7", "c", "09", "9540", "c9"];
const a = [9, 0, 7, 1, 8, 20, 25, 4, 11, 18, 2, 26, 15, 5, 18, 17, 27, 21, 3, 22, 14, 12, 10, 5, 16, 19, 11, 6];
a.map(n=>r[n]).join("");
```

### (4) If the key is 64 chars its probably a valid AES key 🎉

---

## Automated Key Derivation

As detailed in Pass 5 of the "Deobfuscation Process", the `findAndExtractKeyPlugin` (located in `transformers/findAndExtractKey.js`) automates the manual key derivation steps (specifically steps 2 and 3 outlined above).

The plugin operates by:
1.  Identifying all array declarations within the processed code.
2.  Searching for the specific `array.map().join('')` pattern used for key construction.
3.  Attempting to derive a key by applying this pattern with the identified arrays.
4.  Validating if the resulting string is a 64-character hexadecimal value.
5.  Printing any valid keys found directly to the console, along with the names and contents of the source arrays used for derivation.

This automation significantly streamlines the process of obtaining the AES key.

---

## Decrypting the Source

Once the 64-character hexadecimal AES key is obtained (either through the manual steps or via the automated deobfuscation script), it can be used to decrypt the ciphertext from step (1) of the manual process. The `quickDecrypt.js` script provides a ready-to-use example for this decryption, using the `CryptoJS` library.

---

Original Author - Ciarán (Thanks for the deobfuscation scripts!)

[Join Ciarán's Discord](https://discord.gg/z2r8e8neQ7)