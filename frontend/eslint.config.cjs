const js = require("@eslint/js");
const globals = require("globals");
const { FlatCompat } = require("@eslint/eslintrc");
const { fixupConfigRules } = require("@eslint/compat");

// Plugins
const tsParser = require("@typescript-eslint/parser");

const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
});

module.exports = [
    // Global ignores
    {
        ignores: ["dist", "build", "node_modules", "coverage"],
    },

    // Base JS recommendations
    js.configs.recommended,

    // Extend existing configurations via FlatCompat
    ...fixupConfigRules(
        compat.extends(
            "plugin:react/recommended",
            "plugin:react-hooks/recommended",
            "plugin:jsx-a11y/recommended",
            "plugin:@typescript-eslint/recommended",
            "plugin:import/recommended",
            "plugin:import/typescript",
            "plugin:prettier/recommended"
        )
    ),

    // Project specific overrides
    {
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.node,
            },
            parser: tsParser,
            ecmaVersion: "latest",
            sourceType: "module",
            parserOptions: {
                ecmaFeatures: {
                    jsx: true,
                },
            },
        },
        settings: {
            react: {
                version: "detect",
            },
        },
        rules: {
            "prettier/prettier": ["error", { endOfLine: "auto" }],
            "react/react-in-jsx-scope": "off",
            "@typescript-eslint/no-explicit-any": "off",
            "jsx-a11y/no-static-element-interactions": "off",
            "jsx-a11y/click-events-have-key-events": "off",
            "import/order": [
                "error",
                {
                    groups: ["builtin", "external", "internal"],
                    pathGroups: [
                        {
                            pattern: "react",
                            group: "external",
                            position: "before",
                        },
                    ],
                    pathGroupsExcludedImportTypes: ["react"],
                    alphabetize: {
                        order: "asc",
                        caseInsensitive: true,
                    },
                },
            ],
        },
    },
];
