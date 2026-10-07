import { useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { Highlight, themes, type PrismTheme } from 'prism-react-renderer';
import styles from './landing.module.css';

export type CodeTab = { label: string; language: string; code: string; caption?: ReactNode };

// Always dark, whatever the color mode of the site
const theme: PrismTheme = { ...themes.oneDark, plain: { ...themes.oneDark.plain, backgroundColor: 'transparent' } };

export function CodeWindow({ tabs, className }: { tabs: CodeTab[]; className?: string }) {
  const [active, setActive] = useState(0);
  const tab = tabs[active]!;
  return (
    <div className={clsx(styles.window, className)}>
      <div className={styles.windowBar}>
        <span className={styles.dots} aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <div className={styles.tabs} role="tablist">
          {tabs.map((item, index) => (
            <button
              key={item.label}
              type="button"
              role="tab"
              aria-selected={index === active}
              className={clsx(styles.tab, index === active && styles.tabActive)}
              onClick={() => setActive(index)}>
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <Highlight theme={theme} code={tab.code.trim()} language={tab.language}>
        {({ className: highlighted, style, tokens, getLineProps, getTokenProps }) => (
          <pre className={clsx(highlighted, styles.code)} style={style}>
            {tokens.map((line, i) => (
              <div key={i} {...getLineProps({ line })}>
                {line.map((token, key) => (
                  <span key={key} {...getTokenProps({ token })} />
                ))}
              </div>
            ))}
          </pre>
        )}
      </Highlight>
      {tab.caption && <div className={styles.windowCaption}>{tab.caption}</div>}
    </div>
  );
}
