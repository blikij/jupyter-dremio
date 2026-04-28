# jupyter-dremio

A JupyterLab 4.x sidebar extension for browsing the Dremio catalog.

## Features

- Browse spaces, sources, folders, virtual and physical datasets in a left-sidebar tree
- Right-click any node for a context menu: **Open wiki** (renders Dremio wiki Markdown in the main area) or **Copy path to clipboard**
- Drag any catalog node into a notebook cell to insert a ready-to-run SQL snippet
- SSO / Kerberos login (proxy mode) or username/password (both modes)
- Automatic direct mode when the server extension is unavailable

## Install

```bash
pip install jupyter_dremio-0.1.0-py3-none-any.whl
```

See [INSTALL.md](INSTALL.md) for full installation and verification instructions.
