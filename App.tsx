import React, { useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
} from 'react-native';

// ---- Domain types ----

type CadenceKind = 'project' | 'workstream' | 'task';
type CycleStatus = 'open' | 'closed';

interface CadenceCycle {
  id: string;
  index: number; // 0,1,2...
  status: CycleStatus;
  startDate?: string;
  endDate?: string;
  previousPlan: string;
  actuals: string;
  nextPlan: string;
  owner: string; // per-period ownership
}

interface CadenceNode {
  id: string;
  kind: CadenceKind;
  parentId?: string; // undefined for top-level projects
  name: string;
  cadence: 'weekly' | 'monthly' | 'quarterly';
  cycles: CadenceCycle[];
}

type ViewMode = 'entry' | 'review' | 'owners';

interface AppState {
  nodes: CadenceNode[];
  activeProjectId?: string;
  activeWorkstreamId?: string;
  activeTaskId?: string;
  viewMode: ViewMode;
  activeOwner?: string;
  ownerVisibleNodeIds: string[];
}

// ---- Initial sample state ----

const initialState: AppState = {
  nodes: [
    // Project
    {
      id: 'proj-1',
      kind: 'project',
      name: 'Cadence App v2',
      cadence: 'weekly',
      cycles: [
        {
          id: 'proj-1-period-1',
          index: 0,
          status: 'closed',
          startDate: '2025-01-01',
          endDate: '2025-01-07',
          previousPlan:
            'Kick off project; decide on stack and basic PPP concept.',
          actuals: 'Chose React Native + Expo, drafted PPP model idea.',
          nextPlan: 'Define universal cadence object and nesting.',
          owner: 'Dmitri',
        },
        {
          id: 'proj-1-period-2',
          index: 1,
          status: 'open',
          startDate: '2025-01-08',
          previousPlan: 'Define universal cadence object and nesting.',
          actuals: '',
          nextPlan: 'Implement v2 prototype with hierarchical UI.',
          owner: 'Dmitri',
        },
      ],
    },

    // Workstreams under proj-1
    {
      id: 'ws-1',
      kind: 'workstream',
      parentId: 'proj-1',
      name: 'Architecture & Model',
      cadence: 'monthly',
      cycles: [
        {
          id: 'ws-1-period-1',
          index: 0,
          status: 'open',
          startDate: '2025-01-10',
          previousPlan: 'Describe universal cadence object (PPP, periods).',
          actuals: '',
          nextPlan:
            'Add parent/child nesting Project → Workstream → Task.',
          owner: 'Dmitri',
        },
      ],
    },
    {
      id: 'ws-2',
      kind: 'workstream',
      parentId: 'proj-1',
      name: 'Implementation',
      cadence: 'weekly',
      cycles: [
        {
          id: 'ws-2-period-1',
          index: 0,
          status: 'open',
          startDate: '2025-01-12',
          previousPlan: 'Build basic PPP UI in React Native.',
          actuals: '',
          nextPlan: 'Refine layout, add selectors.',
          owner: 'Dmitri',
        },
      ],
    },

    // Tasks under ws-1
    {
      id: 'task-1',
      kind: 'task',
      parentId: 'ws-1',
      name: 'Define universal cadence object',
      cadence: 'weekly',
      cycles: [
        {
          id: 'task-1-period-1',
          index: 0,
          status: 'open',
          startDate: '2025-01-15',
          previousPlan: 'Capture fields for PPP and periods.',
          actuals: '',
          nextPlan: 'Validate model across project/workstream/task.',
          owner: 'Dmitri',
        },
      ],
    },
    {
      id: 'task-2',
      kind: 'task',
      parentId: 'ws-1',
      name: 'Define nesting rules',
      cadence: 'weekly',
      cycles: [
        {
          id: 'task-2-period-1',
          index: 0,
          status: 'open',
          startDate: '2025-01-16',
          previousPlan: 'Decide how nodes reference parents and children.',
          actuals: '',
          nextPlan: 'Implement UI that reflects hierarchy with pills.',
          owner: 'Dmitri',
        },
      ],
    },

    // Tasks under ws-2
    {
      id: 'task-3',
      kind: 'task',
      parentId: 'ws-2',
      name: 'Implement React Native prototype',
      cadence: 'weekly',
      cycles: [
        {
          id: 'task-3-period-1',
          index: 0,
          status: 'open',
          startDate: '2025-01-18',
          previousPlan: 'Get PPP UI running on web + iPhone.',
          actuals: '',
          nextPlan: 'Plug in universal model + hierarchy.',
          owner: 'Dmitri',
        },
      ],
    },
    {
      id: 'task-4',
      kind: 'task',
      parentId: 'ws-2',
      name: 'Implement iPhone layout',
      cadence: 'weekly',
      cycles: [
        {
          id: 'task-4-period-1',
          index: 0,
          status: 'open',
          startDate: '2025-01-19',
          previousPlan: 'Design single-task-per-screen navigation.',
          actuals: '',
          nextPlan: 'Prototype horizontal swipe across periods.',
          owner: 'Alex',
        },
      ],
    },
    {
      id: 'task-5',
      kind: 'task',
      parentId: 'ws-2',
      name: 'Define testing strategy',
      cadence: 'weekly',
      cycles: [
        {
          id: 'task-5-period-1',
          index: 0,
          status: 'open',
          startDate: '2025-01-20',
          previousPlan: 'Outline unit + integration tests.',
          actuals: '',
          nextPlan: 'Implement first test suite for PPP logic.',
          owner: 'Jordan',
        },
      ],
    },
  ],
  activeProjectId: 'proj-1',
  activeWorkstreamId: 'ws-1',
  activeTaskId: 'task-1',
  viewMode: 'entry',
  activeOwner: undefined,
  ownerVisibleNodeIds: [],
};

// ---- Helper functions ----

function getProjects(nodes: CadenceNode[]): CadenceNode[] {
  return nodes.filter((n) => n.kind === 'project');
}

function getWorkstreams(nodes: CadenceNode[], projectId?: string): CadenceNode[] {
  if (!projectId) return [];
  return nodes.filter(
    (n) => n.kind === 'workstream' && n.parentId === projectId
  );
}

function getTasks(nodes: CadenceNode[], workstreamId?: string): CadenceNode[] {
  if (!workstreamId) return [];
  return nodes.filter(
    (n) => n.kind === 'task' && n.parentId === workstreamId
  );
}

// generic children
function getChildren(nodes: CadenceNode[], parentId: string): CadenceNode[] {
  return nodes.filter((n) => n.parentId === parentId);
}

// Determine which node's PPP we are currently viewing:
function getCurrentNode(state: AppState): CadenceNode | undefined {
  const { nodes, activeTaskId, activeWorkstreamId, activeProjectId } = state;
  if (activeTaskId) {
    const task = nodes.find((n) => n.id === activeTaskId);
    if (task) return task;
  }
  if (activeWorkstreamId) {
    const ws = nodes.find((n) => n.id === activeWorkstreamId);
    if (ws) return ws;
  }
  if (activeProjectId) {
    const proj = nodes.find((n) => n.id === activeProjectId);
    if (proj) return proj;
  }
  return nodes[0];
}

// Current cycle: open if exists, else last
function getCurrentCycle(node: CadenceNode): CadenceCycle {
  const open = node.cycles.find((c: CadenceCycle) => c.status === 'open');
  if (open) return open;
  return node.cycles[node.cycles.length - 1];
}

// Past cycles for history
function getPastCycles(node: CadenceNode, current: CadenceCycle): CadenceCycle[] {
  return node.cycles.filter((c: CadenceCycle) => c.id !== current.id);
}

// ---- Date helpers ----

function parseISODate(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00');
}

function formatISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getPeriodLengthDays(cadence: CadenceNode['cadence']): number {
  switch (cadence) {
    case 'weekly':
      return 7;
    case 'monthly':
      return 30;
    case 'quarterly':
      return 90;
    default:
      return 7;
  }
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

function getNextPeriodRange(
  node: CadenceNode,
  cycle: CadenceCycle
): { start: string; end: string } | undefined {
  const len = getPeriodLengthDays(node.cadence);

  if (cycle.endDate) {
    const end = parseISODate(cycle.endDate);
    const nextStart = addDays(end, 1);
    const nextEnd = addDays(nextStart, len - 1);
    return {
      start: formatISODate(nextStart),
      end: formatISODate(nextEnd),
    };
  }

  if (cycle.startDate) {
    const startCur = parseISODate(cycle.startDate);
    const nextStart = addDays(startCur, len);
    const nextEnd = addDays(nextStart, len - 1);
    return {
      start: formatISODate(nextStart),
      end: formatISODate(nextEnd),
    };
  }

  return undefined;
}

// ---- Close period ----

function closeCurrentCycle(node: CadenceNode): CadenceNode {
  const current = getCurrentCycle(node);
  const now = new Date();
  const nextIndex = node.cycles.length;

  const closedCycles: CadenceCycle[] = node.cycles.map((c: CadenceCycle) =>
    c.id === current.id
      ? {
          ...c,
          status: 'closed' as CycleStatus,
          endDate: now.toISOString().slice(0, 10),
        }
      : c
  );

  const newCycle: CadenceCycle = {
    id: `${node.id}-period-${nextIndex + 1}`,
    index: nextIndex,
    status: 'open',
    startDate: now.toISOString().slice(0, 10),
    previousPlan: current.nextPlan || '(carry-over plan)',
    actuals: '',
    nextPlan: '',
    owner: current.owner || '',
  };

  return {
    ...node,
    cycles: [...closedCycles, newCycle],
  };
}

// ---- PPP helpers ----

function getCadenceLabel(cadence: CadenceNode['cadence']): string {
  switch (cadence) {
    case 'weekly':
      return 'week';
    case 'monthly':
      return 'month';
    case 'quarterly':
      return 'quarter';
    default:
      return 'period';
  }
}

function getNodeLabelPrefix(kind: CadenceKind): string {
  return kind === 'project'
    ? 'Project'
    : kind === 'workstream'
    ? 'Workstream'
    : 'Task';
}

function nodeOwnedBy(node: CadenceNode, owner: string | undefined): boolean {
  if (!owner) return false;
  const cycle = getCurrentCycle(node);
  return (cycle.owner || '').trim() === owner.trim();
}

function nodeOrDescendantOwnedBy(
  node: CadenceNode,
  nodes: CadenceNode[],
  owner: string | undefined
): boolean {
  if (!owner) return false;
  if (nodeOwnedBy(node, owner)) return true;
  const children = getChildren(nodes, node.id);
  for (const child of children) {
    if (nodeOrDescendantOwnedBy(child, nodes, owner)) return true;
  }
  return false;
}

function isDescendantOf(
  nodes: CadenceNode[],
  node: CadenceNode,
  ancestorId: string
): boolean {
  let currentParentId = node.parentId;
  while (currentParentId) {
    if (currentParentId === ancestorId) return true;
    const parent = nodes.find((n) => n.id === currentParentId);
    if (!parent) break;
    currentParentId = parent.parentId;
  }
  return false;
}

function ownedNodesUnder(
  nodeId: string,
  nodes: CadenceNode[],
  owner: string
): string[] {
  return nodes
    .filter(
      (n) =>
        nodeOwnedBy(n, owner) &&
        (n.id === nodeId || isDescendantOf(nodes, n, nodeId))
    )
    .map((n) => n.id);
}

// ---- Owner summaries ----

interface OwnerSummaryEntry {
  node: CadenceNode;
  cycle: CadenceCycle;
}

interface OwnerSummary {
  owner: string;
  entries: OwnerSummaryEntry[];
}

function getOwnerSummaries(nodes: CadenceNode[]): OwnerSummary[] {
  const map = new Map<string, OwnerSummaryEntry[]>();

  nodes.forEach((node) => {
    const cycle = getCurrentCycle(node);
    const owner = (cycle.owner || '').trim();
    if (!owner) return;
    if (!map.has(owner)) {
      map.set(owner, []);
    }
    map.get(owner)!.push({ node, cycle });
  });

  const summaries: OwnerSummary[] = [];
  for (const [owner, entries] of map.entries()) {
    summaries.push({ owner, entries });
  }
  summaries.sort((a, b) => a.owner.localeCompare(b.owner));
  return summaries;
}

// ---- PPP header ----

interface PPPHeaderProps {
  nextPlanHeader: string;
}

const PPPHeaderRow: React.FC<PPPHeaderProps> = ({ nextPlanHeader }) => (
  <View style={styles.pppHeaderRow}>
    <View style={[styles.pppHeaderCell, styles.pppObjectHeaderCell]}>
      <Text style={styles.pppHeaderText}>Object</Text>
    </View>
    <View style={styles.pppHeaderCell}>
      <Text style={styles.pppHeaderText}>Previous Plan</Text>
    </View>
    <View style={styles.pppHeaderCell}>
      <Text style={styles.pppHeaderText}>Actuals</Text>
    </View>
    <View style={styles.pppHeaderCell}>
      <Text style={styles.pppHeaderText}>{nextPlanHeader}</Text>
    </View>
  </View>
);

// ---- PPP row (read-only or editable for current open period) ----

interface PPPRowProps {
  node: CadenceNode;
  cycle: CadenceCycle;
  editable: boolean;
  onUpdateField?: (field: 'actuals' | 'nextPlan', value: string) => void;
}

const PPPRow: React.FC<PPPRowProps> = ({
  node,
  cycle,
  editable,
  onUpdateField,
}) => {
  const labelPrefix = getNodeLabelPrefix(node.kind);
  const objectLabel = `${labelPrefix}: ${node.name}`;

  const canEdit = editable && cycle.status === 'open' && !!onUpdateField;

  return (
    <View style={styles.pppRow}>
      {/* Object + Owner (always read-only) */}
      <View style={[styles.pppObjectCell, styles.fieldInputPast]}>
        <Text style={[styles.pastFieldText, styles.pppObjectText]}>
          {objectLabel}
        </Text>
        {cycle.owner ? (
          <Text style={styles.ownerInline}>Owner: {cycle.owner}</Text>
        ) : null}
      </View>

      {/* Previous Plan (always read-only) */}
      <View style={[styles.pppCell, styles.fieldInputPast]}>
        <Text style={styles.pastFieldText}>
          {cycle.previousPlan || '—'}
        </Text>
      </View>

      {/* Actuals */}
      <View style={[styles.pppCell, styles.fieldInputCurrentActuals]}>
        {canEdit ? (
          <TextInput
            style={styles.pppTextInput}
            value={cycle.actuals}
            onChangeText={(text) => onUpdateField?.('actuals', text)}
            multiline
          />
        ) : (
          <Text style={styles.pastFieldText}>
            {cycle.actuals || '—'}
          </Text>
        )}
      </View>

      {/* Next Plan */}
      <View style={[styles.pppCell, styles.fieldInputCurrentNext]}>
        {canEdit ? (
          <TextInput
            style={styles.pppTextInput}
            value={cycle.nextPlan}
            onChangeText={(text) => onUpdateField?.('nextPlan', text)}
            multiline
          />
        ) : (
          <Text style={styles.pastFieldText}>
            {cycle.nextPlan || '—'}
          </Text>
        )}
      </View>
    </View>
  );
};

// ---- Current Period Panel (Entry) ----

interface CurrentPeriodPanelProps {
  node: CadenceNode;
  cycle: CadenceCycle;
  totalPeriods: number;
  onUpdateField: (field: 'actuals' | 'nextPlan', value: string) => void;
  onUpdateOwner: (value: string) => void;
  onClosePeriod: () => void;
}

const CurrentPeriodPanel: React.FC<CurrentPeriodPanelProps> = ({
  node,
  cycle,
  totalPeriods,
  onUpdateField,
  onUpdateOwner,
  onClosePeriod,
}) => {
  const displayIndex = cycle.index;
  const cadenceLabel = getCadenceLabel(node.cadence);
  const nextRange = getNextPeriodRange(node, cycle);

  const nextPlanHeader = nextRange
    ? `Next Plan (next ${cadenceLabel}: ${nextRange.start} → ${nextRange.end})`
    : `Next Plan (for the next ${cadenceLabel})`;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Current Period</Text>
      <Text style={styles.cycleMeta}>
        {getNodeLabelPrefix(node.kind)} · Period {displayIndex + 1} of{' '}
        {totalPeriods} · Status: {cycle.status}
      </Text>
      {cycle.startDate && (
        <Text style={styles.cycleMetaSmall}>
          Current period:{' '}
          {cycle.startDate}
          {cycle.endDate ? ` → ${cycle.endDate}` : ''}
        </Text>
      )}

      {/* Owner entry */}
      <View style={styles.ownerRow}>
        <Text style={styles.fieldLabel}>Owner</Text>
        <TextInput
          style={styles.ownerInput}
          value={cycle.owner}
          onChangeText={onUpdateOwner}
          placeholder="Who owns this period?"
        />
      </View>

      <PPPHeaderRow nextPlanHeader={nextPlanHeader} />
      <PPPRow
        node={node}
        cycle={cycle}
        editable={true}
        onUpdateField={onUpdateField}
      />

      <Pressable style={styles.button} onPress={onClosePeriod}>
        <Text style={styles.buttonText}>Close Period & Create Next</Text>
      </Pressable>
    </View>
  );
};

// ---- Past Periods (Entry) ----

interface PastPeriodsSectionProps {
  node: CadenceNode;
  currentCycle: CadenceCycle;
}

const PastPeriodsSection: React.FC<PastPeriodsSectionProps> = ({
  node,
  currentCycle,
}) => {
  const pastCycles = getPastCycles(node, currentCycle);

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Past Periods</Text>
      {pastCycles.length === 0 ? (
        <Text style={styles.cycleMetaSmall}>
          No past periods yet. Once you close the current period, it will appear
          here.
        </Text>
      ) : (
        pastCycles
          .slice()
          .sort((a: CadenceCycle, b: CadenceCycle) => b.index - a.index)
          .map((c: CadenceCycle) => (
            <View key={c.id} style={styles.pastCycleCard}>
              <Text style={styles.pastCycleTitle}>
                Period {c.index + 1} · {c.status.toUpperCase()}
              </Text>
              <Text style={styles.cycleMetaSmall}>
                {c.startDate
                  ? `From ${c.startDate}${c.endDate ? ` to ${c.endDate}` : ''}`
                  : ''}
              </Text>
              {c.owner ? (
                <Text style={styles.cycleMetaSmall}>Owner: {c.owner}</Text>
              ) : null}

              <Text style={styles.fieldLabelSmall}>Previous Plan</Text>
              <Text style={styles.pastFieldText}>{c.previousPlan}</Text>

              <Text style={styles.fieldLabelSmall}>Actuals</Text>
              <Text style={styles.pastFieldText}>{c.actuals || '—'}</Text>

              <Text style={styles.fieldLabelSmall}>
                Next Plan (at that time)
              </Text>
              <Text style={styles.pastFieldText}>{c.nextPlan || '—'}</Text>
            </View>
          ))
      )}
    </View>
  );
};

// ---- Review Section (Review mode) ----

interface ReviewSectionProps {
  nodes: CadenceNode[];
  currentNode: CadenceNode;
  onUpdateField: (
    nodeId: string,
    field: 'actuals' | 'nextPlan',
    value: string
  ) => void;
}

const ReviewSection: React.FC<ReviewSectionProps> = ({
  nodes,
  currentNode,
  onUpdateField,
}) => {
  const currentCycle = getCurrentCycle(currentNode);
  const cadenceLabel = getCadenceLabel(currentNode.cadence);
  const nextRange = getNextPeriodRange(currentNode, currentCycle);

  const nextPlanHeader = nextRange
    ? `Next Plan (next ${cadenceLabel}: ${nextRange.start} → ${nextRange.end})`
    : `Next Plan (for the next ${cadenceLabel})`;

  let children: CadenceNode[] = [];
  let childrenLabel = '';

  if (currentNode.kind === 'project') {
    children = getWorkstreams(nodes, currentNode.id);
    childrenLabel = 'Workstreams under this Project';
  } else if (currentNode.kind === 'workstream') {
    children = getTasks(nodes, currentNode.id);
    childrenLabel = 'Tasks under this Workstream';
  } else {
    children = [];
    childrenLabel = '';
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Review</Text>
      {currentCycle.startDate && (
        <Text style={styles.cycleMetaSmall}>
          Current period:{' '}
          {currentCycle.startDate}
          {currentCycle.endDate ? ` → ${currentCycle.endDate}` : ''}
        </Text>
      )}
      {nextRange && (
        <Text style={styles.cycleMetaSmall}>
          Next period (for planning): {nextRange.start} → {nextRange.end}
        </Text>
      )}

      <PPPHeaderRow nextPlanHeader={nextPlanHeader} />

      {/* Current node row (editable if open) */}
      <PPPRow
        node={currentNode}
        cycle={currentCycle}
        editable={currentCycle.status === 'open'}
        onUpdateField={(field, value) =>
          onUpdateField(currentNode.id, field, value)
        }
      />

      {/* Children rows (editable if their current period is open) */}
      {childrenLabel && (
        <Text style={[styles.cycleMetaSmall, { marginTop: 8 }]}>
          {childrenLabel}
        </Text>
      )}
      {children.map((child) => {
        const childCycle = getCurrentCycle(child);
        return (
          <PPPRow
            key={child.id}
            node={child}
            cycle={childCycle}
            editable={childCycle.status === 'open'}
            onUpdateField={(field, value) =>
              onUpdateField(child.id, field, value)
            }
          />
        );
      })}
    </View>
  );
};

// ---- Owner overview (Owners mode) ----

interface OwnersOverviewSectionProps {
  summary?: OwnerSummary;
  visibleNodeIds: string[];
  onUpdateField: (
    nodeId: string,
    field: 'actuals' | 'nextPlan',
    value: string
  ) => void;
}

const OwnersOverviewSection: React.FC<OwnersOverviewSectionProps> = ({
  summary,
  visibleNodeIds,
  onUpdateField,
}) => {
  if (!summary) {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Owner Overview</Text>
        <Text style={styles.cycleMetaSmall}>
          Select an owner to see their PPP.
        </Text>
      </View>
    );
  }

  const nextPlanHeader = 'Next Plan (current periods)';
  const visibleEntries = summary.entries.filter((e) =>
    visibleNodeIds.includes(e.node.id)
  );

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Owner Overview</Text>
      <Text style={styles.cycleMetaSmall}>Owner: {summary.owner}</Text>

      {visibleEntries.length === 0 ? (
        <Text style={styles.cycleMetaSmall}>
          No PPP entries selected for this owner. Use the gold-highlighted
          project/workstream/task pills to toggle visibility.
        </Text>
      ) : (
        <>
          <PPPHeaderRow nextPlanHeader={nextPlanHeader} />
          {visibleEntries.map(({ node, cycle }) => (
            <PPPRow
              key={node.id}
              node={node}
              cycle={cycle}
              editable={cycle.status === 'open'}
              onUpdateField={(field, value) =>
                onUpdateField(node.id, field, value)
              }
            />
          ))}
        </>
      )}
    </View>
  );
};

// ---- Pill components ----

interface PillProps {
  label: string;
  active: boolean;
  onPress: () => void;
}

// Mode pills (Entry / Review / Owners) – pink active
const ModePill: React.FC<PillProps> = ({ label, active, onPress }) => (
  <Pressable
    onPress={onPress}
    style={[styles.modePill, active && styles.modePillActive]}
  >
    <Text style={[styles.modePillText, active && styles.modePillTextActive]}>
      {label}
    </Text>
  </Pressable>
);

// Owner pills (for owner selection)
const OwnerPill: React.FC<PillProps> = ({ label, active, onPress }) => (
  <Pressable
    onPress={onPress}
    style={[styles.ownerPill, active && styles.ownerPillActive]}
  >
    <Text
      style={[styles.ownerPillText, active && styles.ownerPillTextActive]}
    >
      {label}
    </Text>
  </Pressable>
);

interface SelectorPillProps {
  label: string;
  active: boolean;
  highlighted?: boolean; // gold border when owner owns this node (directly or via descendants)
  disabled?: boolean;
  onPress: () => void;
}

// Selector pills – green active, gold outline when highlighted in Owners view
const SelectorPill: React.FC<SelectorPillProps> = ({
  label,
  active,
  highlighted,
  disabled,
  onPress,
}) => {
  const handlePress = () => {
    if (disabled) return;
    onPress();
  };

  return (
    <Pressable
      onPress={handlePress}
      style={[
        styles.selectorPill,
        active && styles.selectorPillActive,
        highlighted && styles.selectorPillHighlighted,
        disabled && styles.selectorPillDisabled,
      ]}
    >
      <Text
        style={[
          styles.selectorPillText,
          active && styles.selectorPillTextActive,
          disabled && styles.selectorPillTextDisabled,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
};

// ---- Main App ----

export default function App() {
  const [state, setState] = useState<AppState>(initialState);

  const inOwnersMode = state.viewMode === 'owners';

  // For owners mode, show ALL workstreams/tasks; otherwise, filtered by selection
  const projects = getProjects(state.nodes);
  const workstreams = inOwnersMode
    ? state.nodes.filter((n) => n.kind === 'workstream')
    : getWorkstreams(state.nodes, state.activeProjectId);
  const tasks = inOwnersMode
    ? state.nodes.filter((n) => n.kind === 'task')
    : getTasks(state.nodes, state.activeWorkstreamId);

  const ownerSummaries = getOwnerSummaries(state.nodes);
  const activeOwnerSummary = ownerSummaries.find(
    (s) => s.owner === state.activeOwner
  );

  const currentNode = getCurrentNode(state);
  if (!currentNode) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={[styles.scrollContent, { justifyContent: 'center' }]}>
          <Text style={styles.appTitle}>Cadence v2 Prototype</Text>
          <Text style={styles.nodeSubtitle}>
            No nodes defined. This should not happen with initialState.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const currentCycle = getCurrentCycle(currentNode);
  const totalPeriods = currentNode.cycles.length;
  const currentLabelPrefix = getNodeLabelPrefix(currentNode.kind);

  // Generic "update node field for current open period"
  const handleUpdateNodeField = (
    nodeId: string,
    field: 'actuals' | 'nextPlan',
    value: string
  ) => {
    setState((prev) => {
      const updatedNodes = prev.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        const current = getCurrentCycle(n);
        if (current.status !== 'open') {
          return n;
        }
        const updatedCycles: CadenceCycle[] = n.cycles.map((c: CadenceCycle) =>
          c.id === current.id ? { ...c, [field]: value } : c
        );
        return { ...n, cycles: updatedCycles };
      });
      return { ...prev, nodes: updatedNodes };
    });
  };

  const handleUpdateOwner = (value: string) => {
    if (state.viewMode !== 'entry') return;

    setState((prev) => {
      const nodeToUpdate = getCurrentNode(prev);
      if (!nodeToUpdate) return prev;

      const updatedNodes = prev.nodes.map((n) => {
        if (n.id !== nodeToUpdate.id) return n;
        const current = getCurrentCycle(n);
        if (current.status !== 'open') return n;
        const updatedCycles: CadenceCycle[] = n.cycles.map((c: CadenceCycle) =>
          c.id === current.id ? { ...c, owner: value } : c
        );
        return { ...n, cycles: updatedCycles };
      });

      return { ...prev, nodes: updatedNodes };
    });
  };

  const handleClosePeriod = () => {
    if (state.viewMode !== 'entry') return;

    setState((prev) => {
      const nodeToUpdate = getCurrentNode(prev);
      if (!nodeToUpdate) return prev;

      const updatedNodes = prev.nodes.map((n) =>
        n.id === nodeToUpdate.id ? closeCurrentCycle(n) : n
      );

      return { ...prev, nodes: updatedNodes };
    });
  };

  const handleSelectProject = (projectId: string) => {
    setState((prev) => ({
      ...prev,
      activeProjectId: projectId,
      activeWorkstreamId: undefined,
      activeTaskId: undefined,
    }));
  };

  const handleSelectWorkstream = (workstreamId: string) => {
    setState((prev) => ({
      ...prev,
      activeWorkstreamId: workstreamId,
      activeTaskId: undefined,
    }));
  };

  const handleSelectTask = (taskId: string) => {
    setState((prev) => ({
      ...prev,
      activeTaskId: taskId,
    }));
  };

  const handleSetViewMode = (mode: ViewMode) => {
    setState((prev) => {
      if (mode === 'owners') {
        const summaries = getOwnerSummaries(prev.nodes);
        if (summaries.length === 0) {
          return {
            ...prev,
            viewMode: mode,
            activeOwner: undefined,
            ownerVisibleNodeIds: [],
          };
        }
        // If existing activeOwner is still valid, keep it; otherwise pick first
        const existing = summaries.find((s) => s.owner === prev.activeOwner);
        const chosen = existing ?? summaries[0];
        const visibleIds = chosen.entries.map((e) => e.node.id);
        return {
          ...prev,
          viewMode: mode,
          activeOwner: chosen.owner,
          ownerVisibleNodeIds: visibleIds,
        };
      }
      return { ...prev, viewMode: mode };
    });
  };

  const handleSelectOwner = (owner: string) => {
    setState((prev) => {
      const summaries = getOwnerSummaries(prev.nodes);
      const summary = summaries.find((s) => s.owner === owner);
      if (!summary) {
        return { ...prev, activeOwner: undefined, ownerVisibleNodeIds: [] };
      }
      const visibleIds = summary.entries.map((e) => e.node.id);
      return {
        ...prev,
        activeOwner: owner,
        ownerVisibleNodeIds: visibleIds,
      };
    });
  };

  const handleToggleOwnerNodeBranch = (nodeId: string) => {
    setState((prev) => {
      if (!prev.activeOwner || prev.viewMode !== 'owners') return prev;
      const branchIds = ownedNodesUnder(nodeId, prev.nodes, prev.activeOwner);
      if (branchIds.length === 0) return prev;

      const currentSet = new Set(prev.ownerVisibleNodeIds);
      const allVisible = branchIds.every((id) => currentSet.has(id));

      if (allVisible) {
        branchIds.forEach((id) => currentSet.delete(id));
      } else {
        branchIds.forEach((id) => currentSet.add(id));
      }

      return {
        ...prev,
        ownerVisibleNodeIds: Array.from(currentSet),
      };
    });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <Text style={styles.appTitle}>Cadence v2 Prototype</Text>

        {/* Mode toggle */}
        <View style={styles.modeRow}>
          <ModePill
            label="Entry"
            active={state.viewMode === 'entry'}
            onPress={() => handleSetViewMode('entry')}
          />
          <ModePill
            label="Review"
            active={state.viewMode === 'review'}
            onPress={() => handleSetViewMode('review')}
          />
          <ModePill
            label="Owners"
            active={state.viewMode === 'owners'}
            onPress={() => handleSetViewMode('owners')}
          />
        </View>

        {/* Owner pills (only in Owners mode) */}
        {state.viewMode === 'owners' && (
          <>
            <Text style={styles.selectorLabel}>Owners</Text>
            <View style={styles.ownerPillRow}>
              {ownerSummaries.length === 0 ? (
                <Text style={styles.cycleMetaSmall}>
                  No owners set yet for current periods.
                </Text>
              ) : (
                ownerSummaries.map((s) => (
                  <OwnerPill
                    key={s.owner}
                    label={s.owner}
                    active={s.owner === state.activeOwner}
                    onPress={() => handleSelectOwner(s.owner)}
                  />
                ))
              )}
            </View>
          </>
        )}

        {/* Project pills */}
        <Text style={styles.selectorLabel}>Projects</Text>
        <View style={styles.pillRow}>
          {projects.map((p) => {
            const highlighted =
              state.viewMode === 'owners' &&
              nodeOrDescendantOwnedBy(p, state.nodes, state.activeOwner);
            const disabled =
              state.viewMode === 'owners' && !highlighted;

            const onPress = () => {
              if (state.viewMode === 'owners') {
                if (highlighted) {
                  handleToggleOwnerNodeBranch(p.id);
                }
              } else {
                handleSelectProject(p.id);
              }
            };

            return (
              <SelectorPill
                key={p.id}
                label={p.name}
                active={p.id === state.activeProjectId}
                highlighted={highlighted}
                disabled={disabled}
                onPress={onPress}
              />
            );
          })}
        </View>

        {/* Workstream pills */}
        <Text style={styles.selectorLabel}>Workstreams</Text>
        <View style={styles.pillRow}>
          {workstreams.length === 0 ? (
            <Text style={styles.cycleMetaSmall}>
              No workstreams yet.
            </Text>
          ) : (
            workstreams.map((ws) => {
              const highlighted =
                state.viewMode === 'owners' &&
                nodeOrDescendantOwnedBy(ws, state.nodes, state.activeOwner);
              const disabled =
                state.viewMode === 'owners' && !highlighted;

              const onPress = () => {
                if (state.viewMode === 'owners') {
                  if (highlighted) {
                    handleToggleOwnerNodeBranch(ws.id);
                  }
                } else {
                  handleSelectWorkstream(ws.id);
                }
              };

              return (
                <SelectorPill
                  key={ws.id}
                  label={ws.name}
                  active={ws.id === state.activeWorkstreamId}
                  highlighted={highlighted}
                  disabled={disabled}
                  onPress={onPress}
                />
              );
            })
          )}
        </View>

        {/* Task pills */}
        <Text style={styles.selectorLabel}>Tasks</Text>
        <View style={styles.pillRow}>
          {tasks.length === 0 ? (
            <Text style={styles.cycleMetaSmall}>
              No tasks yet.
            </Text>
          ) : (
            tasks.map((t) => {
              const highlighted =
                state.viewMode === 'owners' &&
                nodeOrDescendantOwnedBy(t, state.nodes, state.activeOwner);
              const disabled =
                state.viewMode === 'owners' && !highlighted;

              const onPress = () => {
                if (state.viewMode === 'owners') {
                  if (highlighted) {
                    handleToggleOwnerNodeBranch(t.id);
                  }
                } else {
                  handleSelectTask(t.id);
                }
              };

              return (
                <SelectorPill
                  key={t.id}
                  label={t.name}
                  active={t.id === state.activeTaskId}
                  highlighted={highlighted}
                  disabled={disabled}
                  onPress={onPress}
                />
              );
            })
          )}
        </View>

        {/* Active node info (Entry / Review only) */}
        {state.viewMode !== 'owners' && (
          <>
            <Text style={styles.nodeTitle}>
              {currentLabelPrefix}: {currentNode.name}
            </Text>
            <Text style={styles.nodeSubtitle}>
              Cadence: {currentNode.cadence}
            </Text>
          </>
        )}

        {/* Main content */}
        {state.viewMode === 'entry' ? (
          <>
            <CurrentPeriodPanel
              node={currentNode}
              cycle={currentCycle}
              totalPeriods={totalPeriods}
              onUpdateField={(field, value) =>
                handleUpdateNodeField(currentNode.id, field, value)
              }
              onUpdateOwner={handleUpdateOwner}
              onClosePeriod={handleClosePeriod}
            />
            <PastPeriodsSection
              node={currentNode}
              currentCycle={currentCycle}
            />
          </>
        ) : state.viewMode === 'review' ? (
          <ReviewSection
            nodes={state.nodes}
            currentNode={currentNode}
            onUpdateField={handleUpdateNodeField}
          />
        ) : (
          <OwnersOverviewSection
            summary={activeOwnerSummary}
            visibleNodeIds={state.ownerVisibleNodeIds}
            onUpdateField={handleUpdateNodeField}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ---- Styles ----

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f3f3f3',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  appTitle: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 8,
  },
  nodeTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 8,
  },
  nodeSubtitle: {
    fontSize: 14,
    color: '#555',
    marginBottom: 12,
  },
  section: {
    marginTop: 16,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  cycleMeta: {
    fontSize: 14,
    color: '#444',
  },
  cycleMetaSmall: {
    fontSize: 12,
    color: '#777',
    marginTop: 2,
    marginBottom: 4,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  fieldLabelSmall: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 6,
  },
  fieldInputPast: {
    backgroundColor: '#f0f0f0',
    color: '#333',
  },
  fieldInputCurrentActuals: {
    backgroundColor: '#e3f2fd',
    color: '#111',
  },
  fieldInputCurrentNext: {
    backgroundColor: '#fff9c4',
    color: '#111',
  },
  // Owner input – pale beige
  ownerRow: {
    marginTop: 8,
    marginBottom: 4,
  },
  ownerInput: {
    borderWidth: 1,
    borderColor: '#ffe0b2',
    borderRadius: 8,
    padding: 6,
    fontSize: 13,
    backgroundColor: '#fff7e6',
  },
  ownerInline: {
    fontSize: 11,
    color: '#555',
    marginTop: 2,
  },
  // Button
  button: {
    marginTop: 16,
    backgroundColor: '#c8e6c9',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#81c784',
  },
  buttonText: {
    color: '#1b5e20',
    fontWeight: '600',
  },
  pastCycleCard: {
    marginTop: 10,
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#f7f7f7',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  pastCycleTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  pastFieldText: {
    fontSize: 13,
    color: '#333',
  },
  selectorLabel: {
    marginTop: 8,
    fontSize: 13,
    fontWeight: '600',
    color: '#444',
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
    marginBottom: 4,
  },
  // Mode pills – pink active
  modeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  modePill: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: '#e0e0e0',
  },
  modePillActive: {
    backgroundColor: '#ffebf1',
    borderWidth: 1,
    borderColor: '#f8bbd0',
  },
  modePillText: {
    fontSize: 12,
    color: '#333',
  },
  modePillTextActive: {
    color: '#880e4f',
    fontWeight: '600',
  },
  // Owner pills
  ownerPillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
    marginBottom: 4,
  },
  ownerPill: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: '#e3f2fd',
  },
  ownerPillActive: {
    backgroundColor: '#bbdefb',
    borderWidth: 1,
    borderColor: '#64b5f6',
  },
  ownerPillText: {
    fontSize: 12,
    color: '#0d47a1',
  },
  ownerPillTextActive: {
    fontWeight: '600',
  },
  // Selector pills – green active, gold highlighted in owners view
  selectorPill: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: '#e0e0e0',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  selectorPillActive: {
    backgroundColor: '#c8e6c9',
    borderColor: '#81c784',
  },
  selectorPillHighlighted: {
    borderWidth: 2,
    borderColor: '#fbc02d',
  },
  selectorPillDisabled: {
    opacity: 0.4,
  },
  selectorPillText: {
    fontSize: 12,
    color: '#333',
  },
  selectorPillTextActive: {
    color: '#1b5e20',
    fontWeight: '600',
  },
  selectorPillTextDisabled: {
    color: '#777',
  },
  // PPP table styles
  pppHeaderRow: {
    flexDirection: 'row',
    marginTop: 8,
    borderBottomWidth: 1,
    borderColor: '#ddd',
    paddingBottom: 4,
  },
  pppHeaderCell: {
    flex: 1,
    paddingHorizontal: 4,
  },
  pppObjectHeaderCell: {
    flex: 1.2,
  },
  pppHeaderText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#444',
  },
  pppRow: {
    flexDirection: 'row',
    marginTop: 6,
  },
  pppObjectCell: {
    flex: 1.2,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    padding: 6,
    justifyContent: 'center',
  },
  pppObjectText: {
    fontWeight: '600',
  },
  pppCell: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    padding: 6,
    marginLeft: 4,
    justifyContent: 'center',
  },
  pppTextInput: {
    fontSize: 13,
    textAlignVertical: 'top',
    minHeight: 40,
  },
});
