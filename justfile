run:
    local-action . src/main.ts .env

test:
    npm run test

package:
    -rm -rf dist
    npm run package

clean:
    -rm -rf dist
    -rm -rf node_modules
