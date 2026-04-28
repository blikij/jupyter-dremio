import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin,
  ILayoutRestorer,
} from '@jupyterlab/application';
import { ICommandPalette, WidgetTracker } from '@jupyterlab/apputils';
import { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import { Message } from '@lumino/messaging';
import { Widget } from '@lumino/widgets';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { dremioIcon } from './icons';
import { DremioPanel } from './components/DremioPanel';
import { WikiWidget } from './WikiWidget';
import { JobsWidget } from './JobsWidget';
import { DremioCredentials } from './api';

const PLUGIN_ID = 'jupyter-dremio:plugin';
const PANEL_ID = 'jupyter-dremio:panel';
const COMMAND_OPEN = 'jupyter-dremio:open';

class DremioWidget extends Widget {
  private _showWiki: (name: string, markdown: string) => void;
  private _showJobs: (creds: DremioCredentials) => void;
  private _newNotebook: (creds: DremioCredentials) => void;

  constructor(
    showWiki: (name: string, markdown: string) => void,
    showJobs: (creds: DremioCredentials) => void,
    newNotebook: (creds: DremioCredentials) => void
  ) {
    super();
    this._showWiki = showWiki;
    this._showJobs = showJobs;
    this._newNotebook = newNotebook;
    this.id = PANEL_ID;
    this.title.icon = dremioIcon;
    this.title.caption = 'Dremio Catalog';
    this.addClass('jp-DremioWidget');
  }

  protected onAfterAttach(_msg: Message): void {
    ReactDOM.render(
      React.createElement(DremioPanel, {
        onShowWiki: this._showWiki,
        onShowJobs: this._showJobs,
        onNewNotebook: this._newNotebook,
      }),
      this.node
    );
  }

  protected onBeforeDetach(_msg: Message): void {
    ReactDOM.unmountComponentAtNode(this.node);
  }
}

const plugin: JupyterFrontEndPlugin<void> = {
  id: PLUGIN_ID,
  description: 'Dremio catalog browser for JupyterLab',
  autoStart: true,
  optional: [ICommandPalette, ILayoutRestorer, INotebookTracker],
  activate: (
    app: JupyterFrontEnd,
    palette: ICommandPalette | null,
    restorer: ILayoutRestorer | null,
    nbTracker: INotebookTracker | null
  ) => {
    const tracker = new WidgetTracker<DremioWidget>({ namespace: PANEL_ID });
    const wikiTracker = new WidgetTracker<WikiWidget>({
      namespace: 'jupyter-dremio-wiki',
    });
    const jobsTracker = new WidgetTracker<JobsWidget>({
      namespace: 'jupyter-dremio-jobs',
    });

    /** Open or update the singleton wiki panel in the main area. */
    const showWiki = (name: string, markdown: string) => {
      let wikiWidget = wikiTracker.find(w => !w.isDisposed);
      if (!wikiWidget) {
        wikiWidget = new WikiWidget();
        void wikiTracker.add(wikiWidget);
      }
      wikiWidget.setContent(name, markdown);
      if (!wikiWidget.isAttached) {
        app.shell.add(wikiWidget, 'main');
      }
      app.shell.activateById(wikiWidget.id);
    };

    /** Open or focus the singleton jobs panel in the main area. */
    const showJobs = (creds: DremioCredentials) => {
      let jobsWidget = jobsTracker.find(w => !w.isDisposed);
      if (!jobsWidget) {
        jobsWidget = new JobsWidget(creds);
        void jobsTracker.add(jobsWidget);
      } else {
        jobsWidget.updateCreds(creds);
      }
      if (!jobsWidget.isAttached) {
        app.shell.add(jobsWidget, 'main');
      }
      app.shell.activateById(jobsWidget.id);
    };

    /** Create a new notebook pre-wired to the current Dremio session. */
    const newNotebook = async (creds: DremioCredentials) => {
      const hostname = new URL(creds.url).hostname;
      const flightUrl = `grpc+tls://${hostname}:32010`;

      // Escape any double-quotes or backslashes that appear in credentials.
      const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

      let code: string;

      if (creds.username && creds.password) {
        // Regular login — password is injected into the kernel silently (see below),
        // so the notebook cell reads it from os.environ without storing it on disk.
        code =
          `from adbc_driver_flightsql import dbapi\n` +
          `import os, pandas as pd\n` +
          `\n` +
          `# Logged in as: ${creds.username}\n` +
          `# Password was injected into this kernel's environment at notebook creation.\n` +
          `dremio_conn = dbapi.connect(\n` +
          `    "${flightUrl}",\n` +
          `    db_kwargs={\n` +
          `        "username": "${esc(creds.username)}",\n` +
          `        "password": os.environ.get("_DREMIO_PWD", ""),\n` +
          `        "adbc.flight.sql.rpc.with_cookie_middleware": "true",\n` +
          `    },\n` +
          `)\n` +
          `\n` +
          `%load_ext sql\n` +
          `%sql dremio_conn --alias dremio\n` +
          `\n` +
          `%config SqlMagic.displaylimit = 50\n` +
          `%config SqlMagic.autopandas = True\n` +
          `\n` +
          `# Use %%sql at the top of a cell to write SQL directly`;
      } else {
        // SSO login (no password stored): pre-fill username, prompt for password.
        const usernameLine = creds.username
          ? `_username = "${esc(creds.username)}"\n`
          : `_username = input("Dremio username: ")\n`;
        code =
          `from adbc_driver_flightsql import dbapi\n` +
          `import os, pandas as pd, getpass\n` +
          `\n` +
          usernameLine +
          `_password = os.environ.get("_DREMIO_PWD") or getpass.getpass(f"Dremio password for {_username}: ")\n` +
          `\n` +
          `dremio_conn = dbapi.connect(\n` +
          `    "${flightUrl}",\n` +
          `    db_kwargs={\n` +
          `        "username": _username,\n` +
          `        "password": _password,\n` +
          `        "adbc.flight.sql.rpc.with_cookie_middleware": "true",\n` +
          `    },\n` +
          `)\n` +
          `\n` +
          `%load_ext sql\n` +
          `%sql dremio_conn --alias dremio\n` +
          `\n` +
          `%config SqlMagic.displaylimit = 50\n` +
          `%config SqlMagic.autopandas = True\n` +
          `\n` +
          `# Use %%sql at the top of a cell to write SQL directly`;
      }

      await app.commands.execute('notebook:create-new', { kernelName: 'python3' });

      // currentWidget is the freshly created notebook
      const panel = nbTracker?.currentWidget as NotebookPanel | null | undefined;
      if (!panel) return;

      await panel.context.ready;
      // Wait for the kernel to be fully connected before injecting credentials.
      await panel.sessionContext.ready;

      const model = panel.content.model;
      if (!model) return;

      // Cell 0 (default empty cell) → Python setup code.
      const firstCell = model.cells.get(0);
      if (firstCell) {
        firstCell.sharedModel.setSource(code);
      }

      // Insert markdown intro at position 0; Python code shifts to position 1.
      const markdown =
        '# Notebook Title\n' +
        '\n' +
        '> _Replace this heading with your analysis title and describe what this notebook is about._\n' +
        '\n' +
        '---\n' +
        '\n' +
        '## Running SQL queries\n' +
        '\n' +
        'After running the **Setup** cell below, use SQL magic cells to query Dremio:\n' +
        '\n' +
        '| Magic | Use for |\n' +
        '|---|---|\n' +
        '| `%%sql` | Multi-line SQL — put this on the **first line** of a cell |\n' +
        '| `%sql SELECT ...` | Inline single-line query |\n' +
        '\n' +
        'Results are returned as **pandas DataFrames** automatically.\n' +
        '\n' +
        '**Tip:** Drag any table from the Dremio sidebar into a cell ' +
        'to insert a ready-made `SELECT` statement with all column names.\n' +
        '\n' +
        '📖 [JupySQL quick-start](https://jupysql.readthedocs.io/en/latest/quick-start.html) ' +
        '&nbsp;·&nbsp; ' +
        '[`%%sql` magic reference](https://jupysql.readthedocs.io/en/latest/api/magic-sql.html)';

      model.sharedModel.insertCell(0, {
        cell_type: 'markdown',
        source: markdown,
        metadata: {},
      });

      // Add %%sql starter cell at the end (position 2).
      model.sharedModel.insertCell(model.cells.length, {
        cell_type: 'code',
        source: '%%sql\n',
        metadata: {},
      });

      // Silently inject the password into the kernel as an environment variable.
      // Using silent:true means no output, no history entry — it never appears in
      // the notebook. The setup cell reads it back via os.environ.get("_DREMIO_PWD").
      if (creds.password) {
        const kernel = panel.sessionContext.session?.kernel;
        if (kernel) {
          kernel.requestExecute({
            code: `import os; os.environ["_DREMIO_PWD"] = "${esc(creds.password)}"`,
            silent: true,
            store_history: false,
          });
        }
      }

      app.shell.activateById(panel.id);
    };

    const createWidget = () => {
      const widget = new DremioWidget(showWiki, showJobs, creds => { void newNotebook(creds); });
      void tracker.add(widget);
      return widget;
    };

    app.commands.addCommand(COMMAND_OPEN, {
      label: 'Open Dremio Catalog',
      icon: dremioIcon,
      execute: () => {
        if (tracker.currentWidget && !tracker.currentWidget.isDisposed) {
          app.shell.activateById(tracker.currentWidget.id);
          return;
        }
        const widget = createWidget();
        app.shell.add(widget, 'left', { rank: 200 });
        app.shell.activateById(widget.id);
      },
    });

    if (palette) {
      palette.addItem({ command: COMMAND_OPEN, category: 'Dremio' });
    }

    if (restorer) {
      restorer.restore(tracker, {
        command: COMMAND_OPEN,
        name: () => PANEL_ID,
      });
    }

    app.restored.then(() => {
      app.commands.execute(COMMAND_OPEN);
    });
  },
};

export default plugin;
