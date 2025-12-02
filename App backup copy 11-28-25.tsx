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
type CadenceType =
  | 'daily'
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'quarterly';

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
  cadence: CadenceType;
  cycles: CadenceCycle[];
}

type ViewMode = 'review' | 'owners' | 'open';

type DueState = 'ontime' | 'duesoon' | 'overdue';

interface AppState {
  nodes: CadenceNode[];
  activeProjectId?: string;
  activeWorkstreamId?: string;
  activeTaskId?: string;
  viewMode: ViewMode;
  activeOwner?: string;
  ownerVisibleNodeIds: string[];

  // Filters for Open mode
  openOwnerFilter?: string;
  openKindFilter: 'all' | CadenceKind;
  openCadenceFilter: 'all' | CadenceType;
  openDueFilter: 'all' | DueState;

  // Advanced toggle
  advancedEnabled: boolean;
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
  viewMode: 'review',
  activeOwner: undefined,
  ownerVisibleNodeIds: [],

  openOwnerFilter: undefined,
  openKindFilter: 'all',
  openCadenceFilter: 'all',
  openDueFilter: 'all',

  advancedEnabled: false,
};

// ---- Helper functions ----

function getProjects(nodes: CadenceNode[]): CadenceNode[] {
  return nodes.filter((n) => n.kind === 'project');
}

function getWorkstreamsForProject(
  nodes: CadenceNode[],
  projectId: string | undefined
): CadenceNode[] {
  if (!projectId) return nodes.filter((n) => n.kind === 'workstream');
  return nodes.filter(
    (n) => n.kind === 'workstream' && n.parentId === projectId
  );
}

function getAllWorkstreams(nodes: CadenceNode[]): CadenceNode[] {
  return nodes.filter((n) => n.kind === 'workstream');
}

function getTasksForWorkstream(
  nodes: CadenceNode[],
  workstreamId: string | undefined
): CadenceNode[] {
  if (!workstreamId) return nodes.filter((n) => n.kind === 'task');
  return nodes.filter(
    (n) => n.kind === 'task' && n.parentId === workstreamId
  );
}

function getTasksForProject(
  nodes: CadenceNode[],
  projectId: string | undefined
): CadenceNode[] {
  if (!projectId) return nodes.filter((n) => n.kind === 'task');
  const workstreams = nodes.filter(
    (n) => n.kind === 'workstream' && n.parentId === projectId
  );
  const wsIds = new Set(workstreams.map((w) => w.id));
  return nodes.filter(
    (n) => n.kind === 'task' && n.parentId && wsIds.has(n.parentId)
  );
}

// generic children
function getChildren(nodes: CadenceNode[], parentId: string): CadenceNode[] {
  return nodes.filter((n) => n.parentId === parentId);
}

// Determine which node's PPP we are currently viewing for context:
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

// ---- Date helpers ----

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function parseISODate(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00');
}

function formatISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getPeriodLengthDays(cadence: CadenceType): number {
  switch (cadence) {
    case 'daily':
      return 1;
    case 'weekly':
      return 7;
    case 'biweekly':
      return 14;
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

// Target end date for an open cycle
function getTargetEndDate(
  node: CadenceNode,
  cycle: CadenceCycle
): Date | undefined {
  if (cycle.endDate) {
    return parseISODate(cycle.endDate);
  }
  if (cycle.startDate) {
    const len = getPeriodLengthDays(node.cadence);
    const start = parseISODate(cycle.startDate);
    return addDays(start, len - 1);
  }
  return undefined;
}

// Due-state calculation for open cycles
function getDueStateForCycle(
  node: CadenceNode,
  cycle: CadenceCycle,
  today: Date
): DueState {
  if (cycle.status !== 'open') return 'ontime';

  const targetEnd = getTargetEndDate(node, cycle);
  if (!targetEnd) {
    return 'ontime';
  }

  const diffDays = Math.floor(
    (targetEnd.getTime() - today.getTime()) / MS_PER_DAY
  );

  if (diffDays < 0) {
    return 'overdue';
  }

  // "Due soon" if within 2 days of target end
  if (diffDays <= 2) {
    return 'duesoon';
  }

  return 'ontime';
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

function getCadenceLabel(cadence: CadenceType): string {
  switch (cadence) {
    case 'daily':
      return 'day';
    case 'weekly':
      return 'week';
    case 'biweekly':
      return 'two weeks';
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
  showActions?: boolean;
}

const PPPHeaderRow: React.FC<PPPHeaderProps> = ({
  nextPlanHeader,
  showActions,
}) => (
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
    {showActions && (
      <View style={[styles.pppHeaderCell, styles.pppActionsHeaderCell]}>
        <Text style={styles.pppHeaderText}>Actions</Text>
      </View>
    )}
  </View>
);

// ---- PPP row (read-only or editable for current open period) ----

interface PPPRowProps {
  node: CadenceNode;
  cycle: CadenceCycle;
  editable: boolean;
  onUpdateField?: (field: 'actuals' | 'nextPlan', value: string) => void;
  statusLabel?: string; // e.g., "Overdue · 2025-01-01 → 2025-01-07"
  // Owner editing
  ownerEditable?: boolean;
  onUpdateOwner?: (value: string) => void;
  // Actions
  onClose?: () => void;
}

const PPPRow: React.FC<PPPRowProps> = ({
  node,
  cycle,
  editable,
  onUpdateField,
  statusLabel,
  ownerEditable,
  onUpdateOwner,
  onClose,
}) => {
  const labelPrefix = getNodeLabelPrefix(node.kind);
  const objectLabel = `${labelPrefix}: ${node.name}`;

  const canEdit = editable && cycle.status === 'open' && !!onUpdateField;
  const canEditOwner =
    ownerEditable && cycle.status === 'open' && !!onUpdateOwner;

  const periodText =
    cycle.startDate || cycle.endDate
      ? `${cycle.startDate || ''}${
          cycle.endDate ? ` → ${cycle.endDate}` : ''
        }`
      : '';

  const effectiveStatusLine = (() => {
    const owner = (cycle.owner || '').trim();
    const parts: string[] = [];
    if (owner) parts.push(`Owner: ${owner}`);
    if (statusLabel) parts.push(statusLabel);
    if (!statusLabel && periodText && !owner) parts.push(periodText);
    return parts.join(' · ');
  })();

  return (
    <View style={styles.pppRow}>
      {/* Object + Owner/Status (owner optionally editable) */}
      <View style={[styles.pppObjectCell, styles.fieldInputPast]}>
        <Text style={[styles.pastFieldText, styles.pppObjectText]}>
          {objectLabel}
        </Text>
        {canEditOwner ? (
          <TextInput
            style={styles.ownerInlineInput}
            value={cycle.owner}
            onChangeText={onUpdateOwner}
            placeholder="Owner?"
          />
        ) : effectiveStatusLine ? (
          <Text style={styles.ownerInline}>{effectiveStatusLine}</Text>
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

      {/* Actions cell (optional) */}
      {onClose && (
        <View style={styles.pppActionsCell}>
          {cycle.status === 'open' ? (
            <Pressable style={styles.closeButton} onPress={onClose}>
              <Text style={styles.closeButtonText}>Close</Text>
            </Pressable>
          ) : (
            <Text style={styles.cycleMetaSmall}>Closed</Text>
          )}
        </View>
      )}
    </View>
  );
};

// ---- Review Section (Structure view) ----

interface ReviewSectionProps {
  nodes: CadenceNode[];
  activeProjectId?: string;
  activeWorkstreamId?: string;
  onUpdateField: (
    nodeId: string,
    field: 'actuals' | 'nextPlan',
    value: string
  ) => void;
  onUpdateOwner: (nodeId: string, value: string) => void;
  onClosePeriod: (nodeId: string) => void;
}

const ReviewSection: React.FC<ReviewSectionProps> = ({
  nodes,
  activeProjectId,
  activeWorkstreamId,
  onUpdateField,
  onUpdateOwner,
  onClosePeriod,
}) => {
  const projects = getProjects(nodes);
  if (projects.length === 0) {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Current PPPs</Text>
        <Text style={styles.cycleMetaSmall}>
          No projects defined yet.
        </Text>
      </View>
    );
  }

  // Determine scope based on active selections
  const project =
    (activeProjectId &&
      nodes.find((n) => n.id === activeProjectId && n.kind === 'project')) ||
    projects[0];

  const workstream =
    activeWorkstreamId &&
    nodes.find(
      (n) => n.id === activeWorkstreamId && n.kind === 'workstream'
    );

  type RowNode = CadenceNode;
  const rows: RowNode[] = [];

  let scopeLabel = '';

  if (workstream) {
    // Workstream + ALL tasks under it
    rows.push(workstream);
    const tasksUnderWS = getTasksForWorkstream(nodes, workstream.id);
    rows.push(...tasksUnderWS);
    scopeLabel = `Workstream: ${workstream.name}`;
  } else if (project) {
    // Project + ALL workstreams + ALL tasks under those workstreams
    rows.push(project);
    const wsUnderProj = getWorkstreamsForProject(nodes, project.id);
    rows.push(...wsUnderProj);

    const tasksUnderProj = getTasksForProject(nodes, project.id);
    rows.push(...tasksUnderProj);

    scopeLabel = `Project: ${project.name}`;
  }

  if (rows.length === 0) {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Current PPPs</Text>
        <Text style={styles.cycleMetaSmall}>
          Nothing to review for current selection.
        </Text>
      </View>
    );
  }

  // Header for "Next Plan" (we use the primary row's cadence for labeling)
  const primaryNode = rows[0];
  const currentCycle = getCurrentCycle(primaryNode);
  const cadenceLabel = getCadenceLabel(primaryNode.cadence);
  const nextRange = getNextPeriodRange(primaryNode, currentCycle);

  const nextPlanHeader = nextRange
    ? `Next Plan (next ${cadenceLabel}: ${nextRange.start} → ${nextRange.end})`
    : `Next Plan (for the next ${cadenceLabel})`;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Current PPPs</Text>
      <Text style={styles.cycleMetaSmall}>
        Scope: {scopeLabel || 'All'}
      </Text>

      <PPPHeaderRow nextPlanHeader={nextPlanHeader} showActions />

      {rows.map((node) => {
        const cycle = getCurrentCycle(node);
        const editable = cycle.status === 'open';
        return (
          <PPPRow
            key={node.id}
            node={node}
            cycle={cycle}
            editable={editable}
            ownerEditable={true}
            onUpdateField={(field, value) =>
              onUpdateField(node.id, field, value)
            }
            onUpdateOwner={(value) => onUpdateOwner(node.id, value)}
            onClose={editable ? () => onClosePeriod(node.id) : undefined}
          />
        );
      })}
    </View>
  );
};

// ---- Owner overview (Owners view) ----

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
        <Text style={styles.sectionTitle}>Owner overview</Text>
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
      <Text style={styles.sectionTitle}>Owner overview</Text>
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

// ---- Open mode section (All open PPPs, advanced) ----

interface OpenEntry {
  node: CadenceNode;
  cycle: CadenceCycle;
  dueState: DueState;
  targetEnd?: Date;
}

interface OpenModeSectionProps {
  entries: OpenEntry[];
  onUpdateField: (
    nodeId: string,
    field: 'actuals' | 'nextPlan',
    value: string
  ) => void;
  onUpdateOwner: (nodeId: string, value: string) => void;
  onClosePeriod: (nodeId: string) => void;
}

const OpenModeSection: React.FC<OpenModeSectionProps> = ({
  entries,
  onUpdateField,
  onUpdateOwner,
  onClosePeriod,
}) => {
  const dueLabel = (state: DueState): string =>
    state === 'overdue'
      ? 'Overdue'
      : state === 'duesoon'
      ? 'Due soon'
      : 'On time';

  const nextPlanHeader = 'Next Plan (current open periods)';

  if (entries.length === 0) {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Open PPPs</Text>
        <Text style={styles.cycleMetaSmall}>
          No open PPP periods match the current filters.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Open PPPs</Text>
      <Text style={styles.cycleMetaSmall}>
        Showing {entries.length} open PPP period
        {entries.length === 1 ? '' : 's'}.
      </Text>

      <PPPHeaderRow nextPlanHeader={nextPlanHeader} showActions />

      {entries.map(({ node, cycle, dueState }) => {
        const periodText =
          cycle.startDate || cycle.endDate
            ? `${cycle.startDate || ''}${
                cycle.endDate ? ` → ${cycle.endDate}` : ''
              }`
            : '';

        const statusLabel = periodText
          ? `${dueLabel(dueState)} · ${periodText}`
          : dueLabel(dueState);

        return (
          <PPPRow
            key={node.id}
            node={node}
            cycle={cycle}
            editable={cycle.status === 'open'}
            ownerEditable={true}
            onUpdateField={(field, value) =>
              onUpdateField(node.id, field, value)
            }
            onUpdateOwner={(value) => onUpdateOwner(node.id, value)}
            statusLabel={statusLabel}
            onClose={() => onClosePeriod(node.id)}
          />
        );
      })}
    </View>
  );
};

// ---- Pill components ----

interface PillProps {
  label: string;
  active: boolean;
  onPress: () => void;
}

// Mode / view pills – pink active
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

// Owner / filter pills
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
  const inReviewMode = state.viewMode === 'review';

  const projects = getProjects(state.nodes);

  // Workstreams visibility:
  const workstreams = inOwnersMode
    ? getAllWorkstreams(state.nodes)
    : state.activeProjectId
    ? getWorkstreamsForProject(state.nodes, state.activeProjectId)
    : getAllWorkstreams(state.nodes);

  // Tasks visibility:
  const tasks = inOwnersMode
    ? state.nodes.filter((n) => n.kind === 'task')
    : state.activeWorkstreamId
    ? getTasksForWorkstream(state.nodes, state.activeWorkstreamId)
    : state.activeProjectId
    ? getTasksForProject(state.nodes, state.activeProjectId)
    : state.nodes.filter((n) => n.kind === 'task');

  const ownerSummaries = getOwnerSummaries(state.nodes);
  const activeOwnerSummary = ownerSummaries.find(
    (s) => s.owner === state.activeOwner
  );

  const currentNode = getCurrentNode(state);
  if (!currentNode) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={[styles.scrollContent, { justifyContent: 'center' }]}>
          <Text style={styles.appTitle}>Cadence Review</Text>
          <Text style={styles.nodeSubtitle}>
            No nodes defined. This should not happen with initialState.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const today = new Date();

  // ---- Open mode data ----
  const openEntriesAll: OpenEntry[] = state.nodes.flatMap((node) => {
    const cycle = getCurrentCycle(node);
    if (cycle.status !== 'open') return [];
    const targetEnd = getTargetEndDate(node, cycle);
    const dueState = getDueStateForCycle(node, cycle, today);
    return [{ node, cycle, dueState, targetEnd }];
  });

  const openOwners = Array.from(
    new Set(
      openEntriesAll
        .map((e) => (e.cycle.owner || '').trim())
        .filter((o) => o.length > 0)
    )
  ).sort();

  const openEntriesFiltered = openEntriesAll.filter((entry) => {
    const { node, cycle, dueState } = entry;

    if (state.openOwnerFilter) {
      const owner = (cycle.owner || '').trim();
      if (owner !== state.openOwnerFilter) return false;
    }

    if (state.openKindFilter !== 'all' && node.kind !== state.openKindFilter) {
      return false;
    }

    if (
      state.openCadenceFilter !== 'all' &&
      node.cadence !== state.openCadenceFilter
    ) {
      return false;
    }

    if (state.openDueFilter !== 'all' && dueState !== state.openDueFilter) {
      return false;
    }

    return true;
  });

  const overdueCount = openEntriesAll.filter(
    (e) => e.dueState === 'overdue'
  ).length;
  const dueSoonCount = openEntriesAll.filter(
    (e) => e.dueState === 'duesoon'
  ).length;

  const earliestTargetEnd = (() => {
    const dates = openEntriesAll
      .map((e) => e.targetEnd)
      .filter((d): d is Date => !!d);
    if (dates.length === 0) return undefined;
    return dates.reduce((min, d) => (d < min ? d : min), dates[0]);
  })();

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

  // Update owner for current open period on a given node
  const handleUpdateNodeOwner = (nodeId: string, value: string) => {
    setState((prev) => {
      const updatedNodes = prev.nodes.map((n) => {
        if (n.id !== nodeId) return n;
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

  // Close period for a specific node
  const handleClosePeriodForNode = (nodeId: string) => {
    setState((prev) => {
      const updatedNodes = prev.nodes.map((n) =>
        n.id === nodeId ? closeCurrentCycle(n) : n
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
      // If advanced is off, we shouldn't go into open
      let nextMode = mode;
      if (!prev.advancedEnabled && mode === 'open') {
        nextMode = 'review';
      }

      if (nextMode === 'owners') {
        const summaries = getOwnerSummaries(prev.nodes);
        if (summaries.length === 0) {
          return {
            ...prev,
            viewMode: nextMode,
            activeOwner: undefined,
            ownerVisibleNodeIds: [],
          };
        }
        const existing = summaries.find((s) => s.owner === prev.activeOwner);
        const chosen = existing ?? summaries[0];
        const visibleIds = chosen.entries.map((e) => e.node.id);
        return {
          ...prev,
          viewMode: nextMode,
          activeOwner: chosen.owner,
          ownerVisibleNodeIds: visibleIds,
        };
      }

      if (nextMode === 'open') {
        // Open is allowed only if advancedEnabled is true (guarded at call-site too)
        return { ...prev, viewMode: 'open' };
      }

      return { ...prev, viewMode: nextMode };
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

  // Open mode filter handlers
  const handleSetOpenOwnerFilter = (owner?: string) => {
    setState((prev) => ({
      ...prev,
      openOwnerFilter: owner,
    }));
  };

  const handleSetOpenKindFilter = (kind: 'all' | CadenceKind) => {
    setState((prev) => ({
      ...prev,
      openKindFilter: kind,
    }));
  };

  const handleSetOpenCadenceFilter = (cadence: 'all' | CadenceType) => {
    setState((prev) => ({
      ...prev,
      openCadenceFilter: cadence,
    }));
  };

  const handleSetOpenDueFilter = (due: 'all' | DueState) => {
    setState((prev) => ({
      ...prev,
      openDueFilter: due,
    }));
  };

  // ALL pills actions
  const clearProjectSelection = () => {
    setState((prev) => ({
      ...prev,
      activeProjectId: undefined,
      activeWorkstreamId: undefined,
      activeTaskId: undefined,
    }));
  };

  const clearWorkstreamSelection = () => {
    setState((prev) => ({
      ...prev,
      activeWorkstreamId: undefined,
      activeTaskId: undefined,
    }));
  };

  const clearTaskSelection = () => {
    setState((prev) => ({
      ...prev,
      activeTaskId: undefined,
    }));
  };

  const toggleAdvanced = () => {
    setState((prev) => {
      const nextEnabled = !prev.advancedEnabled;
      // If we are turning advanced OFF while in open mode, snap back to review
      if (!nextEnabled && prev.viewMode === 'open') {
        return {
          ...prev,
          advancedEnabled: nextEnabled,
          viewMode: 'review',
        };
      }
      return { ...prev, advancedEnabled: nextEnabled };
    });
  };

  const currentLabelPrefix = getNodeLabelPrefix(currentNode.kind);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <Text style={styles.appTitle}>Cadence Review</Text>

        {/* View selection + Advanced toggle (this replaces the old "3 big modes") */}
        <Text style={styles.selectorLabel}>View</Text>
        <View style={styles.modeRow}>
          <ModePill
            label="Structure"
            active={state.viewMode === 'review'}
            onPress={() => handleSetViewMode('review')}
          />
          <ModePill
            label="Owners"
            active={state.viewMode === 'owners'}
            onPress={() => handleSetViewMode('owners')}
          />
          {state.advancedEnabled && (
            <ModePill
              label="Open (advanced)"
              active={state.viewMode === 'open'}
              onPress={() => handleSetViewMode('open')}
            />
          )}
          <Pressable
            style={[
              styles.advancedPill,
              state.advancedEnabled && styles.advancedPillActive,
            ]}
            onPress={toggleAdvanced}
          >
            <Text
              style={[
                styles.advancedPillText,
                state.advancedEnabled && styles.advancedPillTextActive,
              ]}
            >
              {state.advancedEnabled ? 'Advanced: ON' : 'Advanced: OFF'}
            </Text>
          </Pressable>
        </View>

        {/* Open-mode mini summary bar (still always visible; Open view is gated by Advanced) */}
        <View style={styles.openSummaryBar}>
          <Text style={styles.openSummaryText}>
            Open PPP periods: {openEntriesAll.length} (Overdue: {overdueCount},
            Due soon: {dueSoonCount})
          </Text>
          {earliestTargetEnd ? (
            <Text style={styles.openSummaryHint}>
              Next checkpoint: {formatISODate(earliestTargetEnd)}. Use
              "Open (advanced)" to review & close across all objects.
            </Text>
          ) : (
            <Text style={styles.openSummaryHint}>
              No upcoming checkpoints. All PPP periods are closed.
            </Text>
          )}
        </View>

        {/* Owner pills (only in Owners view) */}
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

        {/* Open-mode filters (only when in open + advanced) */}
        {state.viewMode === 'open' && state.advancedEnabled && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Open PPP filters</Text>

            {/* Owner filter */}
            <Text style={styles.selectorLabel}>Owner</Text>
            <View style={styles.ownerPillRow}>
              <OwnerPill
                label="All"
                active={!state.openOwnerFilter}
                onPress={() => handleSetOpenOwnerFilter(undefined)}
              />
              {openOwners.map((owner) => (
                <OwnerPill
                  key={owner}
                  label={owner}
                  active={state.openOwnerFilter === owner}
                  onPress={() => handleSetOpenOwnerFilter(owner)}
                />
              ))}
            </View>

            {/* Level filter */}
            <Text style={styles.selectorLabel}>Level</Text>
            <View style={styles.ownerPillRow}>
              <OwnerPill
                label="All"
                active={state.openKindFilter === 'all'}
                onPress={() => handleSetOpenKindFilter('all')}
              />
              <OwnerPill
                label="Projects"
                active={state.openKindFilter === 'project'}
                onPress={() => handleSetOpenKindFilter('project')}
              />
              <OwnerPill
                label="Workstreams"
                active={state.openKindFilter === 'workstream'}
                onPress={() => handleSetOpenKindFilter('workstream')}
              />
              <OwnerPill
                label="Tasks"
                active={state.openKindFilter === 'task'}
                onPress={() => handleSetOpenKindFilter('task')}
              />
            </View>

            {/* Cadence filter */}
            <Text style={styles.selectorLabel}>Cadence</Text>
            <View style={styles.ownerPillRow}>
              <OwnerPill
                label="All"
                active={state.openCadenceFilter === 'all'}
                onPress={() => handleSetOpenCadenceFilter('all')}
              />
              <OwnerPill
                label="Daily"
                active={state.openCadenceFilter === 'daily'}
                onPress={() => handleSetOpenCadenceFilter('daily')}
              />
              <OwnerPill
                label="Weekly"
                active={state.openCadenceFilter === 'weekly'}
                onPress={() => handleSetOpenCadenceFilter('weekly')}
              />
              <OwnerPill
                label="Biweekly"
                active={state.openCadenceFilter === 'biweekly'}
                onPress={() => handleSetOpenCadenceFilter('biweekly')}
              />
              <OwnerPill
                label="Monthly"
                active={state.openCadenceFilter === 'monthly'}
                onPress={() => handleSetOpenCadenceFilter('monthly')}
              />
              <OwnerPill
                label="Quarterly"
                active={state.openCadenceFilter === 'quarterly'}
                onPress={() => handleSetOpenCadenceFilter('quarterly')}
              />
            </View>

            {/* Due status filter */}
            <Text style={styles.selectorLabel}>Status</Text>
            <View style={styles.ownerPillRow}>
              <OwnerPill
                label="All"
                active={state.openDueFilter === 'all'}
                onPress={() => handleSetOpenDueFilter('all')}
              />
              <OwnerPill
                label="On time"
                active={state.openDueFilter === 'ontime'}
                onPress={() => handleSetOpenDueFilter('ontime')}
              />
              <OwnerPill
                label="Due soon"
                active={state.openDueFilter === 'duesoon'}
                onPress={() => handleSetOpenDueFilter('duesoon')}
              />
              <OwnerPill
                label="Overdue"
                active={state.openDueFilter === 'overdue'}
                onPress={() => handleSetOpenDueFilter('overdue')}
              />
            </View>
          </View>
        )}

        {/* Project pills */}
        <Text style={styles.selectorLabel}>Projects</Text>
        <View style={styles.pillRow}>
          {inReviewMode && (
            <SelectorPill
              label="ALL"
              active={!state.activeProjectId}
              onPress={clearProjectSelection}
            />
          )}
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
          {inReviewMode && (
            <SelectorPill
              label="ALL"
              active={!state.activeWorkstreamId}
              onPress={clearWorkstreamSelection}
            />
          )}
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

        {/* Task pills:
            - Hidden in Structure (review) view
            - Visible in Owners (for gold highlights & branch toggling)
            - Visible in Open view (for filters / highlighting)
        */}
        {state.viewMode !== 'review' && (
          <>
            <Text style={styles.selectorLabel}>Tasks</Text>
            <View style={styles.pillRow}>
              {state.viewMode === 'open' && state.advancedEnabled && (
                <SelectorPill
                  label="ALL"
                  active={!state.activeTaskId}
                  onPress={clearTaskSelection}
                />
              )}
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
          </>
        )}

        {/* Active node info (Structure view only) */}
        {state.viewMode === 'review' && (
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
        {state.viewMode === 'review' ? (
          <ReviewSection
            nodes={state.nodes}
            activeProjectId={state.activeProjectId}
            activeWorkstreamId={state.activeWorkstreamId}
            onUpdateField={handleUpdateNodeField}
            onUpdateOwner={handleUpdateNodeOwner}
            onClosePeriod={handleClosePeriodForNode}
          />
        ) : state.viewMode === 'owners' ? (
          <OwnersOverviewSection
            summary={activeOwnerSummary}
            visibleNodeIds={state.ownerVisibleNodeIds}
            onUpdateField={handleUpdateNodeField}
          />
        ) : (
          state.advancedEnabled && (
            <OpenModeSection
              entries={openEntriesFiltered}
              onUpdateField={handleUpdateNodeField}
              onUpdateOwner={handleUpdateNodeOwner}
              onClosePeriod={handleClosePeriodForNode}
            />
          )
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
  // Mode / view pills – pink active
  modeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
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
  // Advanced toggle pill
  advancedPill: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: '#eeeeee',
    marginLeft: 4,
  },
  advancedPillActive: {
    backgroundColor: '#fff3e0',
    borderWidth: 1,
    borderColor: '#ffb74d',
  },
  advancedPillText: {
    fontSize: 12,
    color: '#555',
  },
  advancedPillTextActive: {
    fontSize: 12,
    color: '#e65100',
    fontWeight: '600',
  },
  // Owner/filter pills
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
  pppActionsHeaderCell: {
    flex: 0.6,
    alignItems: 'center',
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
  pppActionsCell: {
    flex: 0.6,
    marginLeft: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pppTextInput: {
    fontSize: 13,
    textAlignVertical: 'top',
    minHeight: 40,
  },
  // Inline owner editing
  ownerInline: {
    fontSize: 11,
    color: '#555',
    marginTop: 2,
  },
  ownerInlineInput: {
    fontSize: 11,
    color: '#333',
    marginTop: 4,
    paddingVertical: 2,
    paddingHorizontal: 4,
    borderWidth: 1,
    borderColor: '#ffe0b2',
    borderRadius: 6,
    backgroundColor: '#fff7e6',
  },
  // Close button
  closeButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: '#c8e6c9',
    borderWidth: 1,
    borderColor: '#81c784',
  },
  closeButtonText: {
    fontSize: 11,
    color: '#1b5e20',
    fontWeight: '600',
  },
  // Open summary bar
  openSummaryBar: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: '#e8f5e9',
    marginBottom: 4,
  },
  openSummaryText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1b5e20',
  },
  openSummaryHint: {
    fontSize: 11,
    color: '#4caf50',
  },
});
