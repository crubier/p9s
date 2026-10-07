import clsx from 'clsx';
import styles from './landing.module.css';

type Node = { x: number; y: number; kind: string; name: string; lit?: boolean };

const W = 200;
const H = 52;

const roles: Node[] = [
  { x: 30, y: 40, kind: 'organization', name: 'Acme' },
  { x: 30, y: 175, kind: 'team', name: 'Engineering', lit: true },
  { x: 30, y: 310, kind: 'member', name: 'Bob', lit: true },
];

const resources: Node[] = [
  { x: 530, y: 40, kind: 'organization', name: 'Acme' },
  { x: 530, y: 130, kind: 'space', name: 'Engineering', lit: true },
  { x: 530, y: 220, kind: 'folder', name: 'RFCs', lit: true },
  { x: 530, y: 310, kind: 'document', name: 'RFC 12: Soft delete', lit: true },
];

function Box({ node }: { node: Node }) {
  return (
    <g className={clsx(styles.gNode, node.lit && styles.gNodeLit)}>
      <rect x={node.x} y={node.y} width={W} height={H} rx={12} />
      <text x={node.x + 16} y={node.y + 20} className={styles.gKind}>
        {node.kind}
      </text>
      <text x={node.x + 16} y={node.y + 40} className={styles.gName}>
        {node.name}
      </text>
    </g>
  );
}

// Tree edges, from the bottom of a parent to the top of its child
function Edges({ nodes }: { nodes: Node[] }) {
  return (
    <>
      {nodes.slice(1).map((child, i) => {
        const parent = nodes[i]!;
        const x = parent.x + W / 2;
        return (
          <line
            key={child.name + i}
            x1={x}
            y1={parent.y + H}
            x2={x}
            y2={child.y}
            className={clsx(styles.gEdge, parent.lit && child.lit && styles.gFlow)}
          />
        );
      })}
    </>
  );
}

export function PermissionGraph() {
  const team = roles[1]!;
  const space = resources[1]!;
  const bob = roles[2]!;
  const document = resources[3]!;
  return (
    <svg className={styles.graph} viewBox="0 0 760 400" role="img" aria-label="Bob's team is assigned the Engineering space, so Bob can edit the documents below it">
      <text x={30} y={22} className={styles.gHeader}>
        Roles
      </text>
      <text x={530} y={22} className={styles.gHeader}>
        Resources
      </text>
      <Edges nodes={roles} />
      <Edges nodes={resources} />
      <path
        d={`M${team.x + W} ${team.y + H / 2} C 380 ${team.y + H / 2}, 380 ${space.y + H / 2}, ${space.x} ${space.y + H / 2}`}
        className={clsx(styles.gAssignment, styles.gFlow)}
      />
      <g className={styles.gPill}>
        <rect x={300} y={150} width={160} height={44} rx={10} />
        <text x={380} y={167} textAnchor="middle" className={styles.gKind}>
          assignment
        </text>
        <text x={380} y={185} textAnchor="middle" className={styles.gBits}>
          11111000
        </text>
      </g>
      <line x1={bob.x + W} y1={bob.y + H / 2} x2={document.x} y2={document.y + H / 2} className={clsx(styles.gResult, styles.gFlow)} />
      <g className={clsx(styles.gPill, styles.gPillResult)}>
        <rect x={262} y={314} width={236} height={44} rx={10} />
        <text x={380} y={331} textAnchor="middle" className={styles.gKind}>
          resource_permission
        </text>
        <text x={380} y={349} textAnchor="middle" className={styles.gName}>
          read ✓ edit ✓ share ✗
        </text>
      </g>
      {[...roles, ...resources].map((node, i) => (
        <Box key={i} node={node} />
      ))}
    </svg>
  );
}
