import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // Parse all TS files (routes + tests)
    files: ['src/routes/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/lib/supabase'],
              message:
                "Route handlers must use 'getDB' from services/db.ts instead of importing lib/supabase directly. This ensures the ownership filter is always applied via the scoped helpers.",
            },
          ],
        },
      ],
    },
  },
);
