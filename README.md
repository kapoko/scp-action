# SCP Github Action 🚚 

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
      local: dist
      remote: path/to/project # You can use a relative path
```
After deployment folder `dist` will be at `path/to/project/dist` on the server.
### Copy folder to a remote host by jumping through a proxy host
```yaml
  - name: Upload files
    uses: kapoko/scp-action@v0
    with:
      host: ${{ secrets.HOST }}
      username: ${{ secrets.USERNAME }}
      password: ${{ secrets.PASSWORD }}
      proxy_host: ${{ secrets.PROXY_HOST }}
      proxy_username: ${{ secrets.PROXY_USERNAME }}
      proxy_password: ${{ secrets.PROXY_PASSWORD }}
      local: dist/
      remote: /www/path/to/project # Or an absolute path
```
Note the trailing slash after `dist/`. Now only the *contents of dist* will be inside `/www/path/to/project`.
### Copy folder to a remote host with a private key
```yaml
  - name: Upload files
    uses: kapoko/scp-action@v0
    with:
      host: ${{ secrets.HOST }}
      username: ${{ secrets.USERNAME }}
      private_key: ${{ secrets.PRIVATE_KEY }}
      local: dist
      remote: path/to/dist
```
## Options

- **host**: *string* [required]: Hostname or IP of the remote host
- **username**: *string* [required]: Remote host ssh username
- **password**: *string*: Remote host ssh password
- **port**: *number*: Remote host ssh port (default ```22```)
- **private_key**: *string*: Content of server private key. (e.g. content of ~/.ssh/id_rsa)
- **proxy_host**: *string*:  Hostname or IP of the proxy host
- **proxy_username**: *string*: Proxy host ssh username
- **proxy_password**: *string*: Proxy host ssh password
- **proxy_port**: *number*: Proxy host ssh port (default ```22```)
- **proxy_private_key**: *string*: Content of proxy server private key. (e.g. content of ~/.ssh/id_rsa)
- **local**: *string* [required]: Relative path of the local folder to be uploaded
- **remote**: *string* [required]: Path on the remote host

## Development

*Warning:* although I'll try to keep it to a minimum, there might be breaking changes for the ```v0``` version of this action, until it hits `v1`.

The action is writtin in Typescript so it runs immediately on Github's javascript runners without the need to build Docker images, which makes for FAST deployments 🚀. Uses [mscdex/ssh2](https://github.com/mscdex/ssh2).

