import type { ReactNode } from 'react';
import clsx from 'clsx';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  icon: string;
  description: ReactNode;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'Hierarchical Permissions',
    icon: '🌳',
    description: (
      <>
        Model resources and roles as trees (DAGs). Permissions flow through
        parent-child relationships with automatic transitive computation.
      </>
    ),
  },
  {
    title: 'Row Level Security',
    icon: '🔒',
    description: (
      <>
        Generate PostgreSQL RLS policies automatically. Enforce permissions
        at the database level for maximum security.
      </>
    ),
  },
  {
    title: 'High Performance',
    icon: '⚡',
    description: (
      <>
        Cached permission computation with triggers for automatic updates.
        Optimized for read-heavy workloads.
      </>
    ),
  },
];

function Feature({ title, icon, description }: FeatureItem) {
  return (
    <div className={clsx('col col--4')}>
      <div className="text--center">
        <span style={{ fontSize: '4rem' }}>{icon}</span>
      </div>
      <div className="text--center padding-horiz--md">
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
