# SCP Github Action 🚚 

[![](https://github.com/kapoko/scp-action/workflows/Tests/badge.svg)](https://github.com/kapoko/scp-action/actions)

Github action for copying folders from your repository to a remote host with scp-like functionality. Written in Typescript, with support for a proxy / jump host.

## 💡 Example usage

### Copy folder to a remote host
```yaml
  - name: Upload files
    uses: kapoko/scp-action@v0
    with:
      host: ${{ secrets.HOST }}
      username: ${{ secrets.USERNAME }}
      password: ${{ secrets.PASSWORD }}
      source: dist
      target: path/to/project # You can use a relative path
```
After deployment folder `dist` will be at `path/to/project/dist` on the server.

## Options

- `host`: *string* [required]: Hostname or IP of the remote host
- `username`: *string* [required]: Remote host ssh username
- `password`: *string*: Remote host ssh password
- `port`: *number*: Remote host ssh port (default `22`)
- `private_key`: *string*: Content of private key. (e.g. content of ~/.ssh/id_rsa)
- `proxy_host`: *string*:  Hostname or IP of the proxy host
- `proxy_username`: *string*: Proxy host ssh username
- `proxy_password`: *string*: Proxy host ssh password
- `proxy_port`: *number*: Proxy host ssh port (default `22`)
- `proxy_private_key`: *string*: Content of proxy private key. (e.g. content of ~/.ssh/id_rsa)
- `command`: *string*: Shell command to be run *before* uploading files
- `command_after`: *string*: Shell command to be run *after* uploading files
- `source`: *string* [required]: Relative path(s) of the local folder to be uploaded
  - Multiple source folders are supported.
    ```yaml
    source: |
      dist
      some/other/path
    ```
- `target`: *string* [required]: Path on the remote host
- `include_dotfiles`: *boolean*: Include files starting with a dot (default `true`)
- `dry_run`: *boolean*: Connect to the host but don't actually upload files or execute commands (default `false`)
- `preserve_hierarchy`: *boolean*: keep folder structure of given source paths intact when copying to the remote (see below for an example) (default `false`)

  - Tells the action to keep the relative paths in the repo intact, instead of only copying the folder itself to the remote. This can be handy for copying artefacts from different places in your repository to the remote in one go. Consider the following sources and target:
    ```yaml
    source: |
      dist
      some/other/path/public
    target: remotePath
    ```
    When `preserve_hierarchy` is `false` (default) this configuration will result in `/remotePath/dist` and `/remotePath/public`. 

    When `preserve_hierarchy` is `true` it will result in `remotePath/dist` and `remotePath/some/other/path/public`.

## More examples

### Copy folder to a remote host by jumping through a proxy host
```yaml
  - name: Upload files through proxy
    uses: kapoko/scp-action@v0
    with:
      host: ${{ secrets.HOST }}
      username: ${{ secrets.USERNAME }}
      password: ${{ secrets.PASSWORD }}
      proxy_host: ${{ secrets.PROXY_HOST }}
      proxy_username: ${{ secrets.PROXY_USERNAME }}
      proxy_password: ${{ secrets.PROXY_PASSWORD }}
      source: dist/
      target: /www/path/to/project # Or an absolute path
```
Note the trailing slash after `dist/`. Now only the *contents of dist* will be inside `/www/path/to/project`.
### Copy folder to a remote host with a private key
```yaml
  - name: Upload files with private key
    uses: kapoko/scp-action@v0
    with:
      host: ${{ secrets.HOST }}
      username: ${{ secrets.USERNAME }}
      private_key: ${{ secrets.PRIVATE_KEY }}
      source: dist
      target: path/to/dist
```
### Copy multiple source folders and preserving hierarchy
```yaml
  - name: Upload multiple source folders
    uses: kapoko/scp-action@v0
    with:
      host: ${{ secrets.HOST }}
      username: ${{ secrets.USERNAME }}
      password: ${{ secrets.PASSWORD }}
      source: |
        dist
        other/path/public
      target: path/to/project
      preserve_hierarchy: true
```
Because `preserve_hierarchy` is set to `true` the result will be `path/to/project/dist` and `path/to/project/other/path/public`.
### Execute command before and/or after upload
```yaml
  - name: Upload files and execute commands
    uses: kapoko/scp-action@v0
    with:
      host: ${{ secrets.HOST }}
      username: ${{ secrets.USERNAME }}
      private_key: ${{ secrets.PRIVATE_KEY }}
      source: dist
      target: path/to/dist
      command: whoami
      commandAfter: | # Multiline commands are also supported
        composer install && \
        echo 'All done!' 
``` 

## Development

*Warning:* although I'll try to keep it to a minimum, there might be breaking changes for the ```v0``` version of this action, until it hits `v1`.

The action is written in Typescript so it runs immediately on Github's javascript runners without the need to build Docker images, which makes for FAST deployments 🚀. Uses [mscdex/ssh2](https://github.com/mscdex/ssh2).

