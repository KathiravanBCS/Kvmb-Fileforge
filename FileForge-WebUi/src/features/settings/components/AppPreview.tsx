import classes from './AppPreview.module.css';

type Tone = 'light' | 'dark';

interface MockProps {
  tone: Tone;
  rail: boolean;
}

function Mock({ tone, rail }: MockProps) {
  return (
    <div className={classes.mock} data-tone={tone} data-rail={rail || undefined}>
      <div className={classes.sidebar}>
        <span className={classes.navActive} />
        <span className={classes.nav} />
        <span className={classes.nav} />
        <span className={classes.nav} />
      </div>
      <div className={classes.main}>
        <span className={classes.title} />
        <span className={classes.panel} />
      </div>
    </div>
  );
}

interface AppPreviewProps {
  /** `system` shows the light theme split diagonally with the dark one. */
  tone: Tone | 'system';
  /** Icon-only sidebar. */
  rail?: boolean;
}

/** A small, decorative picture of the app shell in a given theme or sidebar width. */
export function AppPreview({ tone, rail = false }: AppPreviewProps) {
  if (tone === 'system') {
    return (
      <div className={classes.frame} aria-hidden>
        <Mock tone="light" rail={rail} />
        <div className={classes.darkHalf}>
          <Mock tone="dark" rail={rail} />
        </div>
      </div>
    );
  }
  return (
    <div className={classes.frame} aria-hidden>
      <Mock tone={tone} rail={rail} />
    </div>
  );
}
