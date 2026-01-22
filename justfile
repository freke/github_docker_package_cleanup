install:
    npm install

run: install
    local-action . src/main.ts .env

test: install
    npm run test

package: install
    -rm -rf dist
    npm run format:write
    npm run package

check: install
    npm run format:check

lint: install
    npm run lint

fix: install
    npm audit fix
    npm run format:write
    eslint . --fix

clean:
    -rm -rf dist
    -rm -rf node_modules
