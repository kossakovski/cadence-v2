import React, { useEffect, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ---- Stage 0 LLM onboarding screen ----

import SetupScreen from './screens/SetupScreen';

// ---- Domain types ----

type CadenceKind = 'project' | 'workstream' | 'task';
type CycleStatus = 'open' | 'closed';
type CadenceType = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly';

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
  reviewed?: boolean; // true when "Complete Update" is clicked for this cycle
}

interface CadenceNode {
  id: string;
  kind: CadenceKind;
  parentId?: string; // undefined for top-level projects
  name: string;
  cadence: CadenceType;
  cycles: CadenceCycle[]; // for MVP, cadence table is meaningful only for tasks
  retired?: boolean;

  // Workstream milestone support (for kind === 'workstream')
  milestone?: string;
  milestoneDate?: string;
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

  // Workstream milestone toggle
  showWorkstreamMilestones: boolean;
}
type SetupResult = {
  projectName: string;
  workstreams: {
    name: string;
    tasks: {
      name: string;
      owner?: string;
      cadence?: CadenceType;
    }[];
  }[];
};


// ---- Initial sample state ----

const initialState: AppState = {
  nodes: [],
  activeProjectId: undefined,
  activeWorkstreamId: undefined,
  activeTaskId: undefined,
  viewMode: 'review',
  activeOwner: undefined,
  ownerVisibleNodeIds: [],

  openOwnerFilter: undefined,
  openKindFilter: 'all',
  openCadenceFilter: 'all',
  openDueFilter: 'all',

  showWorkstreamMilestones: false,
};

// ---- Helper functions ----

function getProjects(nodes: CadenceNode[]): CadenceNode[] {
  return nodes.filter((n) => n.kind === 'project' && !n.retired);
}

function getWorkstreamsForProject(
  nodes: CadenceNode[],
  projectId: string | undefined
): CadenceNode[] {
  if (!projectId) {
    return nodes.filter((n) => n.kind === 'workstream' && !n.retired);
  }
  return nodes.filter(
    (n) =>
      n.kind === 'workstream' && n.parentId === projectId && !n.retired
  );
}

function getAllWorkstreams(nodes: CadenceNode[]): CadenceNode[] {
  return nodes.filter((n) => n.kind === 'workstream' && !n.retired);
}

function getTasksForWorkstream(
  nodes: CadenceNode[],
  workstreamId: string | undefined
): CadenceNode[] {
  if (!workstreamId) {
    return nodes.filter((n) => n.kind === 'task' && !n.retired);
  }
  return nodes.filter(
    (n) =>
      n.kind === 'task' && n.parentId === workstreamId && !n.retired
  );
}

function getTasksForProject(
  nodes: CadenceNode[],
  projectId: string | undefined
): CadenceNode[] {
  if (!projectId) {
    return nodes.filter((n) => n.kind === 'task' && !n.retired);
  }
  const workstreams = nodes.filter(
    (n) =>
      n.kind === 'workstream' && n.parentId === projectId && !n.retired
  );
  const wsIds = new Set(workstreams.map((w) => w.id));
  return nodes.filter(
    (n) =>
      n.kind === 'task' &&
      !n.retired &&
      n.parentId &&
      wsIds.has(n.parentId)
  );
}

// generic children
function getChildren(nodes: CadenceNode[], parentId: string): CadenceNode[] {
  return nodes.filter((n) => n.parentId === parentId && !n.retired);
}

// Determine which node's cadence table we are currently viewing for context:
function getCurrentNode(state: AppState): CadenceNode | undefined {
  const { nodes, activeTaskId, activeWorkstreamId, activeProjectId } = state;

  if (activeTaskId) {
    const task = nodes.find((n) => n.id === activeTaskId && !n.retired);
    if (task) return task;
  }
  if (activeWorkstreamId) {
    const ws = nodes.find(
      (n) => n.id === activeWorkstreamId && !n.retired
    );
    if (ws) return ws;
  }
  if (activeProjectId) {
    const proj = nodes.find((n) => n.id === activeProjectId && !n.retired);
    if (proj) return proj;
  }
  return nodes.find((n) => !n.retired);
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

// Human-readable date formatting: "March 1" or "March 1 – March 7" (no year)
function formatHumanDate(dateStr?: string): string | undefined {
  if (!dateStr) return undefined;
  try {
    const d = parseISODate(dateStr);
    if (Number.isNaN(d.getTime())) return dateStr;
    const monthNames = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ];
    const month = monthNames[d.getMonth()];
    const day = d.getDate();
    return `${month} ${day}`;
  } catch {
    return dateStr;
  }
}

function formatHumanDateRange(
  startStr?: string,
  endStr?: string
): string | undefined {
  if (!startStr && !endStr) return undefined;
  const startLabel = formatHumanDate(startStr);
  const endLabel = formatHumanDate(endStr);
  if (startLabel && endLabel) {
    return `${startLabel} – ${endLabel}`;
  }
  return startLabel || endLabel || undefined;
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
  const len = getPeriodLengthDays(node.cadence);

  let closedEnd: Date;
  let nextStart: Date;

  if (current.startDate) {
    // Normal case: derive everything from the period start + cadence
    const start = parseISODate(current.startDate);
    closedEnd = addDays(start, len - 1); // end of this period
    nextStart = addDays(start, len);     // start of next period
  } else if (current.endDate) {
    // Fallback: if we somehow only have an end date
    const end = parseISODate(current.endDate);
    closedEnd = end;
    nextStart = addDays(end, 1);
  } else {
    // Last-resort fallback: use "today"
    const today = new Date();
    closedEnd = today;
    nextStart = addDays(today, len);
  }

  const closedEndStr = formatISODate(closedEnd);
  const nextStartStr = formatISODate(nextStart);

  const nextIndex = node.cycles.length;

  const closedCycles: CadenceCycle[] = node.cycles.map((c: CadenceCycle) =>
    c.id === current.id
      ? {
          ...c,
          status: 'closed' as CycleStatus,
          endDate: closedEndStr,
        }
      : c
  );

  const newCycle: CadenceCycle = {
    id: `${node.id}-period-${nextIndex + 1}`,
    index: nextIndex,
    status: 'open',
    startDate: nextStartStr,
    previousPlan: current.nextPlan || '(carry-over plan)',
    actuals: '',
    nextPlan: '',
    owner: current.owner || '',
    reviewed: false,
  };

  return {
    ...node,
    cycles: [...closedCycles, newCycle],
  };
}


// ---- Cadence helpers ----

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
  if (!node.cycles || node.cycles.length === 0) return false;

  const cycle = getCurrentCycle(node);
  if (!cycle) return false;

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
    if (node.kind !== 'task' || node.retired) return;
    if (!node.cycles || node.cycles.length === 0) return;
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

// ---- Cadence header ----

interface PPPHeaderProps {
  nextPlanHeader: string;
  showActions?: boolean;
  previousDateLabel?: string;
  actualDateLabel?: string;
  nextDateLabel?: string;
}

const PPPHeaderRow: React.FC<PPPHeaderProps> = ({
  nextPlanHeader,
  showActions,
  previousDateLabel,
  actualDateLabel,
  nextDateLabel,
}) => (
  <View style={styles.pppHeaderRow}>
    <View style={[styles.pppHeaderCell, styles.pppObjectHeaderCell]}>
      <Text style={styles.pppHeaderText}>Object</Text>
    </View>

    <View style={styles.pppHeaderCell}>
      <Text style={styles.pppHeaderText}>Previous Plan</Text>
      {previousDateLabel ? (
        <Text style={styles.pppHeaderSubText}>{previousDateLabel}</Text>
      ) : null}
    </View>

    <View style={styles.pppHeaderCell}>
      <Text style={styles.pppHeaderText}>Actuals</Text>
      {actualDateLabel ? (
        <Text style={styles.pppHeaderSubText}>{actualDateLabel}</Text>
      ) : null}
    </View>

    <View style={styles.pppHeaderCell}>
      <Text style={styles.pppHeaderText}>{nextPlanHeader}</Text>
      {nextDateLabel ? (
        <Text style={styles.pppHeaderSubText}>{nextDateLabel}</Text>
      ) : null}
    </View>

    {showActions && (
      <View style={[styles.pppHeaderCell, styles.pppActionsHeaderCell]}>
        <Text style={styles.pppHeaderText}>Actions</Text>
      </View>
    )}
  </View>
);

// ---- Cadence row (read-only or editable for current open period) ----

interface PPPRowProps {
  node: CadenceNode;
  cycle: CadenceCycle;
  editable: boolean;
  onUpdateField?: (field: 'actuals' | 'nextPlan', value: string) => void;
  statusLabel?: string; // e.g., "Overdue · March 1 – March 7"
  // Owner editing
  ownerEditable?: boolean;
  onUpdateOwner?: (value: string) => void;
  // Actions
  isReviewed?: boolean;
  onCompleteUpdate?: () => void;
  onRetire?: () => void;
}

const PPPRow: React.FC<PPPRowProps> = ({
  node,
  cycle,
  editable,
  onUpdateField,
  statusLabel,
  ownerEditable,
  onUpdateOwner,
  isReviewed,
  onCompleteUpdate,
  onRetire,
}) => {
  const labelPrefix = getNodeLabelPrefix(node.kind);
  const baseLabel = `${labelPrefix}: ${node.name}`;
  const objectLabel =
    node.kind === 'task' && isReviewed ? `${baseLabel} ✅` : baseLabel;

  const canEdit = editable && cycle.status === 'open' && !!onUpdateField;
  const canEditOwner =
    ownerEditable && cycle.status === 'open' && !!onUpdateOwner;

  const periodText =
    formatHumanDateRange(cycle.startDate, cycle.endDate) || '';

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
      {(onCompleteUpdate || onRetire) && (
        <View style={styles.pppActionsCell}>
          {onCompleteUpdate && (
            <Pressable
              disabled={isReviewed}
              style={[
                styles.completeUpdateButton,
                isReviewed && styles.completeUpdateButtonDisabled,
              ]}
              onPress={onCompleteUpdate}
            >
              <Text
                style={[
                  styles.completeUpdateButtonText,
                  isReviewed && styles.completeUpdateButtonTextDisabled,
                ]}
              >
                {isReviewed ? 'Updated ✓' : 'Complete Update'}
              </Text>
            </Pressable>
          )}
          {onRetire && (
            <Pressable
              style={styles.retireButton}
              onPress={onRetire}
            >
              <Text style={styles.retireButtonText}>Retire</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
};

// ---- Review Section (Review mode) ----

interface ReviewSectionProps {
  nodes: CadenceNode[];
  activeProjectId?: string;
  activeWorkstreamId?: string;
  activeTaskId?: string;
  onUpdateField: (
    nodeId: string,
    field: 'actuals' | 'nextPlan',
    value: string
  ) => void;
  onUpdateOwner: (nodeId: string, value: string) => void;
  onCompleteUpdateForNode: (nodeId: string) => void;
  onRetireNode: (nodeId: string) => void;

  // Global period completion
  reviewCycleOffset: number;
  onChangeReviewCycleOffset: (offset: number) => void;
  onCompletePeriodForScope: (taskIds: string[]) => void;
}

// Visible cycle helper: 0 = latest, 1 = previous, etc.
function getVisibleCycleForNode(
  node: CadenceNode,
  offset: number
): CadenceCycle {
  const sorted = node.cycles.slice().sort((a, b) => a.index - b.index);
  const total = sorted.length;
  if (total === 0) {
    // should not happen, but fallback to a dummy cycle to avoid crashes
    return {
      id: `${node.id}-dummy`,
      index: 0,
      status: 'open',
      previousPlan: '',
      actuals: '',
      nextPlan: '',
      owner: '',
      reviewed: false,
    };
  }
  const clampedOffset = Math.min(offset, total - 1);
  const visibleIdx = total - 1 - clampedOffset; // count from end
  return sorted[visibleIdx];
}

const ReviewSection: React.FC<ReviewSectionProps> = ({
  nodes,
  activeProjectId,
  activeWorkstreamId,
  activeTaskId,
  onUpdateField,
  onUpdateOwner,
  onCompleteUpdateForNode,
  onRetireNode,
  reviewCycleOffset,
  onChangeReviewCycleOffset,
  onCompletePeriodForScope,
}) => {
  const projects = getProjects(nodes);
  if (projects.length === 0) {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Cadence Review</Text>
        <Text style={styles.cycleMetaSmall}>
          No projects defined yet.
        </Text>
      </View>
    );
  }

  // Determine scope based on active selections
  const project =
    activeProjectId &&
    nodes.find(
      (n) => n.id === activeProjectId && n.kind === 'project' && !n.retired
    );

  const workstream =
    activeWorkstreamId &&
    nodes.find(
      (n) =>
        n.id === activeWorkstreamId &&
        n.kind === 'workstream' &&
        !n.retired
    );

  const task =
    activeTaskId &&
    nodes.find(
      (n) => n.id === activeTaskId && n.kind === 'task' && !n.retired
    );

  type RowNode = CadenceNode;
  const rows: RowNode[] = [];

  let scopeLabel = '';
  let scopeOwnerLabel: string | undefined = undefined;

  if (task) {
    // Most specific: show just this Task
    rows.push(task);
    scopeLabel = `Task: ${task.name}`;
  } else if (workstream) {
    // All tasks under the selected workstream
    const tasksUnderWS = getTasksForWorkstream(nodes, workstream.id);
    rows.push(...tasksUnderWS);
    scopeLabel = `Workstream: ${workstream.name}`;

    // Derive owner(s) from tasks under this workstream
    const ownerSet = new Set<string>();
    tasksUnderWS.forEach((t) => {
      if (!t.cycles || t.cycles.length === 0) return;
      const c = getCurrentCycle(t);
      const o = (c.owner || '').trim();
      if (o) ownerSet.add(o);
    });

    if (ownerSet.size > 0) {
      const owners = Array.from(ownerSet).sort();
      scopeOwnerLabel =
        owners.length === 1
          ? `Owner: ${owners[0]}`
          : `Owners: ${owners.join(', ')}`;
    }
  } else if (project) {
    // All tasks under the selected project
    const tasksUnderProj = getTasksForProject(nodes, project.id);
    rows.push(...tasksUnderProj);
    scopeLabel = `Project: ${project.name}`;
  } else {
    // No specific scope → all tasks in the system
    const allTasks = getTasksForProject(nodes, undefined);
    rows.push(...allTasks);
    scopeLabel = 'All tasks';
  }

  if (rows.length === 0) {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Cadence Review</Text>
        <Text style={styles.cycleMetaSmall}>
          Nothing to review for current selection.
        </Text>
      </View>
    );
  }

  // Navigation info based on the primary node (first row)
  const primaryNode = rows[0];
  const primarySortedCycles = primaryNode.cycles
    .slice()
    .sort((a, b) => a.index - b.index);
  const totalCycles = primarySortedCycles.length;
  const clampedOffset = Math.min(
    reviewCycleOffset,
    Math.max(totalCycles - 1, 0)
  );
  const visibleIdx = totalCycles - 1 - clampedOffset;
  const visiblePrimaryCycle =
    primarySortedCycles[Math.max(0, visibleIdx)] || primarySortedCycles[0];

    // Header date ranges for Previous / Actuals / Next
  const cadenceLabel = getCadenceLabel(primaryNode.cadence);
  const nextRange = getNextPeriodRange(primaryNode, visiblePrimaryCycle);

  // Actuals = visible period
  const actualStart = visiblePrimaryCycle.startDate;
  let actualEnd = visiblePrimaryCycle.endDate;
  if (!actualEnd) {
    const targetEnd = getTargetEndDate(primaryNode, visiblePrimaryCycle);
    if (targetEnd) {
      actualEnd = formatISODate(targetEnd);
    }
  }
  const actualRangeLabel = formatHumanDateRange(actualStart, actualEnd);

  // Previous Plan = same period as Actuals
  const previousRangeLabel = actualRangeLabel;

  // Next Plan = next period range
  const nextRangeLabel = nextRange
    ? formatHumanDateRange(nextRange.start, nextRange.end)
    : undefined;


  // Simple label text for the top line
  const nextPlanHeader = 'Next Plan';

  const canGoPrev = clampedOffset < totalCycles - 1;
  const canGoNext = clampedOffset > 0;

  const handlePrev = () => {
    if (!canGoPrev) return;
    const nextOffset = Math.min(reviewCycleOffset + 1, totalCycles - 1);
    onChangeReviewCycleOffset(nextOffset);
  };

  const handleNext = () => {
    if (!canGoNext) return;
    const nextOffset = Math.max(reviewCycleOffset - 1, 0);
    onChangeReviewCycleOffset(nextOffset);
  };

  const handleLatest = () => {
    if (reviewCycleOffset === 0) return;
    onChangeReviewCycleOffset(0);
  };

  // Compute task-level review summary for current period
  const isCurrentPeriod = reviewCycleOffset === 0;
  const taskRows = rows.filter((n) => n.kind === 'task');
  const openTaskCycles = isCurrentPeriod
    ? taskRows.map((node) => {
        const cycle = getVisibleCycleForNode(node, reviewCycleOffset);
        return { node, cycle };
      })
    : [];
  const openTaskCyclesFiltered = openTaskCycles.filter(
    ({ cycle }) => cycle.status === 'open'
  );

  const totalOpenTasksInScope = openTaskCyclesFiltered.length;
  const reviewedTasksInScope = openTaskCyclesFiltered.filter(
    ({ cycle }) => !!cycle.reviewed
  ).length;
  const canCompletePeriod =
    isCurrentPeriod &&
    totalOpenTasksInScope > 0 &&
    reviewedTasksInScope === totalOpenTasksInScope;

  const handleCompletePeriodClick = () => {
    const taskIds = openTaskCyclesFiltered.map(({ node }) => node.id);
    if (taskIds.length > 0) {
      onCompletePeriodForScope(taskIds);
    }
  };

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Cadence Review</Text>
      <Text style={styles.cycleMetaSmall}>
        Scope: {scopeLabel || 'All'}
      </Text>
      {scopeOwnerLabel && (
        <Text style={styles.cycleMetaSmall}>{scopeOwnerLabel}</Text>
      )}

      {/* Period navigation row */}
      <View style={styles.cycleNavRow}>
        {/* No more "Cycle N of N" – only navigation buttons */}
        <View style={styles.cycleNavButtons}>
          <Pressable
            onPress={handlePrev}
            disabled={!canGoPrev}
            style={[
              styles.cycleNavButton,
              !canGoPrev && styles.cycleNavButtonDisabled,
            ]}
          >
            <Text
              style={[
                styles.cycleNavButtonText,
                !canGoPrev && styles.cycleNavButtonTextDisabled,
              ]}
            >
              ◀ Prev
            </Text>
          </Pressable>
          <Pressable
            onPress={handleNext}
            disabled={!canGoNext}
            style={[
              styles.cycleNavButton,
              !canGoNext && styles.cycleNavButtonDisabled,
            ]}
          >
            <Text
              style={[
                styles.cycleNavButtonText,
                !canGoNext && styles.cycleNavButtonTextDisabled,
              ]}
            >
              Next ▶
            </Text>
          </Pressable>
          {clampedOffset > 0 && (
            <Pressable
              onPress={handleLatest}
              style={styles.cycleNavButton}
            >
              <Text style={styles.cycleNavButtonText}>Latest</Text>
            </Pressable>
          )}
        </View>
      </View>

      <PPPHeaderRow
        nextPlanHeader={nextPlanHeader}
        previousDateLabel={previousRangeLabel}
        actualDateLabel={actualRangeLabel}
        nextDateLabel={nextRangeLabel}
        showActions
      />

      {rows.map((node) => {
        const cycle = getVisibleCycleForNode(node, reviewCycleOffset);
        const editable =
          node.kind === 'task' &&
          cycle.status === 'open' &&
          reviewCycleOffset === 0;

        const showActions = node.kind === 'task';

        return (
          <PPPRow
            key={node.id}
            node={node}
            cycle={cycle}
            editable={editable}
            ownerEditable={editable}
            onUpdateField={
              editable
                ? (field, value) => onUpdateField(node.id, field, value)
                : undefined
            }
            onUpdateOwner={
              editable ? (value) => onUpdateOwner(node.id, value) : undefined
            }
            isReviewed={!!cycle.reviewed}
            onCompleteUpdate={
              showActions
                ? () => onCompleteUpdateForNode(node.id)
                : undefined
            }
            onRetire={showActions ? () => onRetireNode(node.id) : undefined}
          />
        );
      })}

      {/* Period-level completion footer */}
      {isCurrentPeriod && (
        <View style={styles.periodFooter}>
          {totalOpenTasksInScope === 0 ? (
            <Text style={styles.periodFooterText}>
              No open tasks in this scope for the current period.
            </Text>
          ) : (
            <Text style={styles.periodFooterText}>
              {reviewedTasksInScope} of {totalOpenTasksInScope} tasks
              updated.
            </Text>
          )}
          <Pressable
            onPress={handleCompletePeriodClick}
            disabled={!canCompletePeriod}
            style={[
              styles.completePeriodButton,
              !canCompletePeriod && styles.completePeriodButtonDisabled,
            ]}
          >
            <Text
              style={[
                styles.completePeriodButtonText,
                !canCompletePeriod &&
                  styles.completePeriodButtonTextDisabled,
              ]}
            >
              Complete Period Update
            </Text>
          </Pressable>
        </View>
      )}
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
          Select an owner to see their cadence items.
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
          No items selected for this owner. Use the gold-highlighted
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

// ---- Open mode section (All open periods) ----

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
  onCompleteUpdateForNode: (nodeId: string) => void;
  onRetireNode: (nodeId: string) => void;
}

const OpenModeSection: React.FC<OpenModeSectionProps> = ({
  entries,
  onUpdateField,
  onUpdateOwner,
  onCompleteUpdateForNode,
  onRetireNode,
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
        <Text style={styles.sectionTitle}>Open Periods</Text>
        <Text style={styles.cycleMetaSmall}>
          No open periods match the current filters.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Open Periods</Text>
      <Text style={styles.cycleMetaSmall}>
        Showing {entries.length} open period
        {entries.length === 1 ? '' : 's'}.
      </Text>

      <PPPHeaderRow nextPlanHeader={nextPlanHeader} showActions />

      {entries.map(({ node, cycle, dueState }) => {
        const periodText =
          formatHumanDateRange(cycle.startDate, cycle.endDate) || '';

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
            isReviewed={!!cycle.reviewed}
            onCompleteUpdate={() => onCompleteUpdateForNode(node.id)}
            onRetire={() => onRetireNode(node.id)}
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

// Mode pills (Review / Owners / Open) – pink active
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

// ---- ID helper ----

function generateNodeId(kind: CadenceKind): string {
  return `${kind}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

// ---- Main App ----

const STORAGE_KEY = 'cadence-app-state-v1';

export default function App() {
  const [state, setState] = useState<AppState>(initialState);
  const [isHydrated, setIsHydrated] = useState(false);

  // global cycle offset for Review view (0 = latest)
  const [reviewCycleOffset, setReviewCycleOffset] = useState(0);

  // Help overlay toggle
  const [showHelp, setShowHelp] = useState(false);

  // Advanced toggle
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Stage 0 SetupScreen toggle (not persisted yet – MVP)
  const [showSetup, setShowSetup] = useState(true);

  // Create-new local UI state
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');

  const [isCreatingWorkstream, setIsCreatingWorkstream] = useState(false);
  const [newWorkstreamName, setNewWorkstreamName] = useState('');

  const [isCreatingTask, setIsCreatingTask] = useState(false);
  const [newTaskName, setNewTaskName] = useState('');
  const [newTaskOwner, setNewTaskOwner] = useState('');
  const [newTaskCadence, setNewTaskCadence] =
    useState<CadenceType>('weekly');

  // Load persisted state on mount
  useEffect(() => {
    const loadState = async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed: AppState = JSON.parse(stored);
          setState(parsed);
        }
      } catch (err) {
        console.error('Failed to load Cadence state:', err);
      } finally {
        setIsHydrated(true);
      }
    };

    loadState();
  }, []);

  const handleSetupComplete = (data: SetupResult) => {
    const nowStr = formatISODate(new Date());

    const projectId = generateNodeId('project');

    const projectNode: CadenceNode = {
      id: projectId,
      kind: 'project',
      name: data.projectName || 'My first cadence project',
      cadence: 'weekly',
      cycles: [],
    };

    const workstreamNodes: CadenceNode[] = [];
    const taskNodes: CadenceNode[] = [];

    data.workstreams.forEach((ws) => {
      const wsId = generateNodeId('workstream');

      const wsNode: CadenceNode = {
        id: wsId,
        kind: 'workstream',
        parentId: projectId,
        name: ws.name || 'Workstream',
        cadence: 'weekly',
        cycles: [],
      };
      workstreamNodes.push(wsNode);

      ws.tasks.forEach((task) => {
        const taskId = generateNodeId('task');
        const cadence = task.cadence || 'weekly';

        const firstCycle: CadenceCycle = {
          id: `${taskId}-period-1`,
          index: 0,
          status: 'open',
          startDate: nowStr,
          previousPlan: '',
          actuals: '',
          nextPlan: '',
          owner: (task.owner || '').trim(),
          reviewed: false,
        };

        const taskNode: CadenceNode = {
          id: taskId,
          kind: 'task',
          parentId: wsId,
          name: task.name || 'Task',
          cadence,
          cycles: [firstCycle],
        };

        taskNodes.push(taskNode);
      });
    });

    const allNodes = [projectNode, ...workstreamNodes, ...taskNodes];

    setState((prev) => ({
      ...prev,
      nodes: allNodes,
      activeProjectId: projectId,
      activeWorkstreamId: workstreamNodes[0]?.id,
      activeTaskId: taskNodes[0]?.id,
      viewMode: 'review',
    }));

    // Optional: reset review cycle offset to latest
    setReviewCycleOffset(0);
  };


  // If we already have nodes from a previous run, skip SetupScreen
  useEffect(() => {
    if (isHydrated && state.nodes.length > 0) {
      setShowSetup(false);
    }
  }, [isHydrated, state.nodes.length]);

  // Persist state whenever it changes (after hydration)
  useEffect(() => {
    if (!isHydrated) return; // prevent overwriting before load finishes

    const saveState = async () => {
      try {
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (err) {
        console.error('Failed to save Cadence state:', err);
      }
    };
    saveState();
  }, [state, isHydrated]);


  
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
    ? state.nodes.filter((n) => n.kind === 'task' && !n.retired)
    : state.activeWorkstreamId
    ? getTasksForWorkstream(state.nodes, state.activeWorkstreamId)
    : state.activeProjectId
    ? getTasksForProject(state.nodes, state.activeProjectId)
    : state.nodes.filter((n) => n.kind === 'task' && !n.retired);

  const ownerSummaries = getOwnerSummaries(state.nodes);
  const activeOwnerSummary = ownerSummaries.find(
    (s) => s.owner === state.activeOwner
  );

  // Show a tiny loading state while hydrating from AsyncStorage
  if (!isHydrated) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={[styles.scrollContent, { justifyContent: 'center' }]}>
          <Text style={styles.appTitle}>Cadence v2 Prototype</Text>
          <Text style={styles.nodeSubtitle}>Loading your cadence…</Text>
        </View>
      </SafeAreaView>
    );
  }
  // Show tiny loading state while hydrating from AsyncStorage
  if (!isHydrated) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={[styles.scrollContent, { justifyContent: 'center' }]}>
          <Text style={styles.appTitle}>Cadence v2 Prototype</Text>
          <Text style={styles.nodeSubtitle}>Loading your cadence…</Text>
        </View>
      </SafeAreaView>
    );
  }

  // 👉 Stage 0 Setup Wizard: when there is no structure yet
  if (state.nodes.length === 0) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <SetupScreen onComplete={handleSetupComplete} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  const today = new Date();
  // ... rest of your existing App code

  // ---- Open mode data ----
  const openEntriesAll: OpenEntry[] = state.nodes.flatMap((node) => {
    if (node.kind !== 'task' || node.retired) return [];
    if (!node.cycles || node.cycles.length === 0) return [];
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

  const earliestTargetEndLabel = earliestTargetEnd
    ? formatHumanDate(formatISODate(earliestTargetEnd))
    : undefined;

  // ---- Handlers ----

  // Generic "update node field for current open period"
  const handleUpdateNodeField = (
    nodeId: string,
    field: 'actuals' | 'nextPlan',
    value: string
  ) => {
    setState((prev) => {
      if (!prev) return prev;
      const updatedNodes = prev.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        if (!n.cycles || n.cycles.length === 0) return n;
        const current = getCurrentCycle(n);
        if (current.status !== 'open') {
          return n;
        }
        const updatedCycles: CadenceCycle[] = n.cycles.map(
          (c: CadenceCycle) =>
            c.id === current.id
              ? { ...c, [field]: value, reviewed: false }
              : c
        );
        return { ...n, cycles: updatedCycles };
      });
      return { ...prev, nodes: updatedNodes };
    });
  };

  // Update owner for current open period on a given node
  const handleUpdateNodeOwner = (nodeId: string, value: string) => {
    setState((prev) => {
      if (!prev) return prev;
      const updatedNodes = prev.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        if (!n.cycles || n.cycles.length === 0) return n;
        const current = getCurrentCycle(n);
        if (current.status !== 'open') return n;
        const updatedCycles: CadenceCycle[] = n.cycles.map(
          (c: CadenceCycle) =>
            c.id === current.id ? { ...c, owner: value, reviewed: false } : c
        );
        return { ...n, cycles: updatedCycles };
      });
      return { ...prev, nodes: updatedNodes };
    });
  };

  // Mark a task's current cycle as reviewed (Complete Update)
  const handleCompleteUpdateForNode = (nodeId: string) => {
    setState((prev) => {
      if (!prev) return prev;
      const updatedNodes = prev.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        if (!n.cycles || n.cycles.length === 0) return n;
        const current = getCurrentCycle(n);
        if (current.status !== 'open') return n;
        const updatedCycles: CadenceCycle[] = n.cycles.map(
          (c: CadenceCycle) =>
            c.id === current.id ? { ...c, reviewed: true } : c
        );
        return { ...n, cycles: updatedCycles };
      });
      return { ...prev, nodes: updatedNodes };
    });
  };

  // Retire node (primarily tasks for MVP)
  const handleRetireNode = (nodeId: string) => {
    setState((prev) => {
      if (!prev) return prev;
      const nowStr = formatISODate(new Date());
      const updatedNodes = prev.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        let cycles = n.cycles;
        if (cycles && cycles.length > 0) {
          const current = getCurrentCycle(n);
          if (current.status === 'open') {
            cycles = cycles.map((c) =>
              c.id === current.id
                ? { ...c, status: 'closed', endDate: nowStr }
                : c
            );
          }
        }
        return { ...n, cycles, retired: true };
      });

      const next: AppState = { ...prev, nodes: updatedNodes };

      if (next.activeTaskId === nodeId) next.activeTaskId = undefined;
      if (next.activeWorkstreamId === nodeId)
        next.activeWorkstreamId = undefined;
      if (next.activeProjectId === nodeId) next.activeProjectId = undefined;

      return next;
    });
  };

  // Complete period for scope (closes current period for all given tasks)
  const handleCompletePeriodForScope = (taskIds: string[]) => {
    const idSet = new Set(taskIds);
    setState((prev) => {
      if (!prev) return prev;
      const updatedNodes = prev.nodes.map((n) => {
        if (!idSet.has(n.id)) return n;
        if (!n.cycles || n.cycles.length === 0) return n;
        const current = getCurrentCycle(n);
        if (current.status !== 'open') return n;
        return closeCurrentCycle(n);
      });
      return { ...prev, nodes: updatedNodes };
    });
  };

  const handleSelectProject = (projectId: string) => {
    setReviewCycleOffset(0);
    setState((prev) =>
      prev
        ? {
            ...prev,
            activeProjectId: projectId,
            activeWorkstreamId: undefined,
            activeTaskId: undefined,
          }
        : prev
    );
  };

  const handleSelectWorkstream = (workstreamId: string) => {
    setReviewCycleOffset(0);
    setState((prev) => {
      if (!prev) return prev;

      // Find the workstream to get its parent project
      const ws = prev.nodes.find(
        (n) => n.id === workstreamId && n.kind === 'workstream'
      );

      const projectId = ws?.parentId; // should be the parent project

      return {
        ...prev,
        activeProjectId: projectId ?? prev.activeProjectId,
        activeWorkstreamId: workstreamId,
        activeTaskId: undefined,
      };
    });
  };

  const handleSelectTask = (taskId: string) => {
    setReviewCycleOffset(0);
    setState((prev) => {
      if (!prev) return prev;

      const task = prev.nodes.find(
        (n) => n.id === taskId && n.kind === 'task'
      );

      let workstreamId = task?.parentId;
      let projectId = prev.activeProjectId;

      if (workstreamId) {
        const ws = prev.nodes.find(
          (n) => n.id === workstreamId && n.kind === 'workstream'
        );
        if (ws?.parentId) {
          projectId = ws.parentId;
        }
      }

      return {
        ...prev,
        activeProjectId: projectId,
        activeWorkstreamId: workstreamId ?? prev.activeWorkstreamId,
        activeTaskId: taskId,
      };
    });
  };

  const handleSetViewMode = (mode: ViewMode) => {
    if (mode === 'review') {
      setReviewCycleOffset(0);
    }
    setState((prev) => {
      if (!prev) return prev;
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
      if (!prev) return prev;
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
      if (!prev || !prev.activeOwner || prev.viewMode !== 'owners') return prev;
      const branchIds = ownedNodesUnder(
        nodeId,
        prev.nodes,
        prev.activeOwner
      );
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
    setState((prev) => (prev ? { ...prev, openOwnerFilter: owner } : prev));
  };

  const handleSetOpenKindFilter = (kind: 'all' | CadenceKind) => {
    setState((prev) =>
      prev
        ? {
            ...prev,
            openKindFilter: kind,
          }
        : prev
    );
  };

  const handleSetOpenCadenceFilter = (cadence: 'all' | CadenceType) => {
    setState((prev) =>
      prev
        ? {
            ...prev,
            openCadenceFilter: cadence,
          }
        : prev
    );
  };

  const handleSetOpenDueFilter = (due: 'all' | DueState) => {
    setState((prev) =>
      prev
        ? {
            ...prev,
            openDueFilter: due,
          }
        : prev
    );
  };

  // ---- Debug: reset all data ----
  const handleResetAllData = async () => {
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      console.error('Failed to clear stored Cadence state:', err);
    }

    // Reset in-memory state
    setState(initialState);
    setReviewCycleOffset(0);
    setShowAdvanced(false);
    setShowSetup(true); // show Setup again after full reset
  };

  // Workstream milestones toggle
  const toggleWorkstreamMilestones = () => {
    setState((prev) =>
      prev
        ? {
            ...prev,
            showWorkstreamMilestones: !prev.showWorkstreamMilestones,
          }
        : prev
    );
  };

  const handleUpdateWorkstreamMilestone = (
    wsId: string,
    field: 'milestone' | 'milestoneDate',
    value: string
  ) => {
    setState((prev) => {
      if (!prev) return prev;
      const updatedNodes = prev.nodes.map((n) =>
        n.id === wsId ? { ...n, [field]: value } : n
      );
      return { ...prev, nodes: updatedNodes };
    });
  };

  // ALL pills actions (Review)
  const clearProjectSelection = () => {
    setReviewCycleOffset(0);
    setState((prev) =>
      prev
        ? {
            ...prev,
            activeProjectId: undefined,
            activeWorkstreamId: undefined,
            activeTaskId: undefined,
          }
        : prev
    );
  };

  const clearWorkstreamSelection = () => {
    setReviewCycleOffset(0);
    setState((prev) =>
      prev
        ? {
            ...prev,
            activeWorkstreamId: undefined,
            activeTaskId: undefined,
          }
        : prev
    );
  };

  const clearTaskSelection = () => {
    setReviewCycleOffset(0);
    setState((prev) =>
      prev
        ? {
            ...prev,
            activeTaskId: undefined,
          }
        : prev
    );
  };

  // For context line under pills
  const currentTask = state.nodes.find(
    (n) => n.id === state.activeTaskId && n.kind === 'task' && !n.retired
  );
  const currentWs = state.nodes.find(
    (n) =>
      n.id === state.activeWorkstreamId &&
      n.kind === 'workstream' &&
      !n.retired
  );
  const currentProj = state.nodes.find(
    (n) =>
      n.id === state.activeProjectId && n.kind === 'project' && !n.retired
  );

  // Advanced toggle handler
  const toggleAdvanced = () => {
    setShowAdvanced((prevShow) => {
      const newShow = !prevShow;
      if (!newShow && state.viewMode === 'open') {
        // If we hide advanced while in Open mode, bounce back to Review
        handleSetViewMode('review');
      }
      return newShow;
    });
  };

  // ---- Create new objects ----

  const handleCreateProject = () => {
    if (!state) return;
    const name = newProjectName.trim() || 'Untitled project';
    const newId = generateNodeId('project');
    const newNode: CadenceNode = {
      id: newId,
      kind: 'project',
      name,
      cadence: 'weekly',
      cycles: [],
    };
    setState({
      ...state,
      nodes: [...state.nodes, newNode],
      activeProjectId: newId,
      activeWorkstreamId: undefined,
      activeTaskId: undefined,
    });
    setIsCreatingProject(false);
    setNewProjectName('');
  };

  const handleCreateWorkstream = () => {
    if (!state) return;
    if (!state.activeProjectId) {
      console.warn('Cannot create workstream without an active project.');
      return;
    }

    const name = newWorkstreamName.trim() || 'Untitled workstream';
    const newId = generateNodeId('workstream');
    const newNode: CadenceNode = {
      id: newId,
      kind: 'workstream',
      parentId: state.activeProjectId,
      name,
      cadence: 'weekly',
      cycles: [],
    };

    setState({
      ...state,
      nodes: [...state.nodes, newNode],
      activeWorkstreamId: newId,
      activeTaskId: undefined,
    });
    setIsCreatingWorkstream(false);
    setNewWorkstreamName('');
  };

  const handleCreateTask = () => {
    if (!state) return;
    if (!state.activeWorkstreamId) {
      console.warn('Cannot create task without an active workstream.');
      return;
    }

    const name = newTaskName.trim() || 'Untitled task';
    const newId = generateNodeId('task');
    const nowStr = formatISODate(new Date());
    const newCycle: CadenceCycle = {
      id: `${newId}-period-1`,
      index: 0,
      status: 'open',
      startDate: nowStr,
      previousPlan: '',
      actuals: '',
      nextPlan: '',
      owner: newTaskOwner.trim(),
      reviewed: false,
    };
    const newNode: CadenceNode = {
      id: newId,
      kind: 'task',
      parentId: state.activeWorkstreamId,
      name,
      cadence: newTaskCadence,
      cycles: [newCycle],
    };

    setState({
      ...state,
      nodes: [...state.nodes, newNode],
      activeTaskId: newId,
    });
    setIsCreatingTask(false);
    setNewTaskName('');
    setNewTaskOwner('');
    setNewTaskCadence('weekly');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <Text style={styles.appTitle}>Cadence v2 Prototype</Text>

        {/* Mode toggle + Help + Advanced */}
        <View style={styles.modeRow}>
          <ModePill
            label="Cadence Review"
            active={state.viewMode === 'review'}
            onPress={() => handleSetViewMode('review')}
          />
          <ModePill
            label="Owners"
            active={state.viewMode === 'owners'}
            onPress={() => handleSetViewMode('owners')}
          />
        {/* Help + Advanced */}
          <Pressable
            onPress={() => setShowHelp((prev) => !prev)}
            style={[
              styles.helpPill,
              showHelp && styles.helpPillActive,
            ]}
          >
            <Text
              style={[
                styles.helpPillText,
                showHelp && styles.helpPillTextActive,
              ]}
            >
              Help
            </Text>
          </Pressable>
          <Pressable
            onPress={toggleAdvanced}
            style={[
              styles.advancedToggle,
              showAdvanced && styles.advancedToggleActive,
            ]}
          >
            <Text
              style={[
                styles.advancedToggleText,
                showAdvanced && styles.advancedToggleTextActive,
              ]}
            >
              Advanced {showAdvanced ? '▾' : '▸'}
            </Text>
          </Pressable>
        </View>

        {/* Help section */}
        {showHelp && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>How to use Cadence</Text>
            <Text style={styles.cycleMetaSmall}>
              1. <Text style={{ fontWeight: '600' }}>Set up your structure.</Text>{'\n'}
              {'   '}• Create a <Text style={{ fontWeight: '600' }}>project</Text> (e.g. “North Star program”).{'\n'}
              {'   '}• Under a project, create one or more <Text style={{ fontWeight: '600' }}>workstreams</Text>.{'\n'}
              {'   '}• Under each workstream, create <Text style={{ fontWeight: '600' }}>tasks</Text> with owners and cadence.
            </Text>
            <Text style={styles.cycleMetaSmall}>
              2. <Text style={{ fontWeight: '600' }}>During the period</Text> (week / month, etc.) update:{'\n'}
              {'   '}• <Text style={{ fontWeight: '600' }}>Actuals</Text>: what really happened in this period.{'\n'}
              {'   '}• <Text style={{ fontWeight: '600' }}>Next Plan</Text>: what you commit to for the next period.
            </Text>
            <Text style={styles.cycleMetaSmall}>
              3. <Text style={{ fontWeight: '600' }}>Cadence Review ritual.</Text>{'\n'}
              {'   '}• Use the <Text style={{ fontWeight: '600' }}>Cadence Review</Text> tab once per period.{'\n'}
              {'   '}• Choose scope via the <Text style={{ fontWeight: '600' }}>project / workstream / task</Text> pills.{'\n'}
              {'   '}• For the current period, review each task and click{' '}
              <Text style={{ fontWeight: '600' }}>“Complete Update”</Text> when its Actuals and Next Plan are done.{'\n'}
              {'   '}• When all tasks in scope are updated, use{' '}
              <Text style={{ fontWeight: '600' }}>“Complete Period Update”</Text> at the bottom to close this period and open the next.
            </Text>
            <Text style={styles.cycleMetaSmall}>
              4. <Text style={{ fontWeight: '600' }}>Other views.</Text>{'\n'}
              {'   '}• <Text style={{ fontWeight: '600' }}>Owners</Text> view: see everything assigned to one person, across projects.{'\n'}
              {'   '}• <Text style={{ fontWeight: '600' }}>Advanced → Open</Text> view: see and filter all open periods (overdue, due soon, etc.).
            </Text>
          </View>
        )}

        {showAdvanced && (
          <View style={styles.modeRow}>
            <ModePill
              label="Open"
              active={state.viewMode === 'open'}
              onPress={() => handleSetViewMode('open')}
            />

            {/* Debug reset */}
            <Pressable
              onPress={handleResetAllData}
              style={styles.debugPill}
            >
              <Text style={styles.debugPillText}>Reset all data</Text>
            </Pressable>
          </View>
        )}

        {/* Tiny getting-started guide – only when no projects exist */}
        {projects.length === 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Getting started</Text>
            <Text style={styles.cycleMetaSmall}>
              1. Create a project using “＋ Add project”.{'\n'}
              2. Add one or more workstreams under that project.{'\n'}
              3. Add tasks under a workstream, then use “Cadence Review”
              once per week to update Actuals and Next Plan.
            </Text>
          </View>
        )}

        {state.viewMode !== 'open' && (
          <View style={styles.openSummaryBar}>
            <Text style={styles.openSummaryText}>
              Open periods: {openEntriesAll.length} (Overdue:{' '}
              {overdueCount}, Due soon: {dueSoonCount})
            </Text>
            {earliestTargetEndLabel ? (
              <Text style={styles.openSummaryHint}>
                Next checkpoint: {earliestTargetEndLabel}. Switch to
                Advanced → "Open" mode to review & complete.
              </Text>
            ) : (
              <Text style={styles.openSummaryHint}>
                No upcoming checkpoints. All tracked periods are closed.
              </Text>
            )}
          </View>
        )}

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

        {/* Open-mode filters */}
        {state.viewMode === 'open' && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Open Period Filters</Text>

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

          {/* Add Project pill */}
          <Pressable
            style={styles.addPill}
            onPress={() => setIsCreatingProject(true)}
          >
            <Text style={styles.addPillText}>＋ Add project</Text>
          </Pressable>
        </View>

        {/* New Project entry row */}
        {isCreatingProject && (
          <View style={styles.createRow}>
            <TextInput
              style={styles.createTextInput}
              placeholder="Project name"
              value={newProjectName}
              onChangeText={setNewProjectName}
            />
            <View style={styles.createActionsRow}>
              <Pressable
                style={styles.createActionPill}
                onPress={handleCreateProject}
              >
                <Text style={styles.createActionPillText}>Add</Text>
              </Pressable>
              <Pressable
                style={styles.createActionPillSecondary}
                onPress={() => {
                  setIsCreatingProject(false);
                  setNewProjectName('');
                }}
              >
                <Text style={styles.createActionPillSecondaryText}>
                  Cancel
                </Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Workstream pills */}
        <Text style={styles.selectorLabel}>
          Workstreams{' '}
          <Text
            style={styles.linkText}
            onPress={toggleWorkstreamMilestones}
          >
            [
            {state.showWorkstreamMilestones
              ? 'Hide milestones'
              : 'Show milestones'}
            ]
          </Text>
        </Text>
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

          {/* Add Workstream pill (requires active project) */}
          <Pressable
            style={[
              styles.addPill,
              !state.activeProjectId && styles.addPillDisabled,
            ]}
            onPress={() => {
              if (!state.activeProjectId) {
                return; // require a selected project
              }
              setIsCreatingWorkstream(true);
            }}
          >
            <Text style={styles.addPillText}>＋ Add workstream</Text>
          </Pressable>
        </View>

        {/* New Workstream entry row */}
        {isCreatingWorkstream && (
          <View style={styles.createRow}>
            <TextInput
              style={styles.createTextInput}
              placeholder="Workstream name"
              value={newWorkstreamName}
              onChangeText={setNewWorkstreamName}
            />
            <View style={styles.createActionsRow}>
              <Pressable
                style={styles.createActionPill}
                onPress={handleCreateWorkstream}
              >
                <Text style={styles.createActionPillText}>Add</Text>
              </Pressable>
              <Pressable
                style={styles.createActionPillSecondary}
                onPress={() => {
                  setIsCreatingWorkstream(false);
                  setNewWorkstreamName('');
                }}
              >
                <Text style={styles.createActionPillSecondaryText}>
                  Cancel
                </Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Workstream milestones section */}
        {state.showWorkstreamMilestones && workstreams.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Workstream Milestones</Text>
            {workstreams.map((ws) => (
              <View key={ws.id} style={styles.milestoneRow}>
                <Text style={styles.milestoneWsName}>{ws.name}</Text>
                <TextInput
                  style={styles.milestoneInput}
                  placeholder="Milestone"
                  value={ws.milestone || ''}
                  onChangeText={(text) =>
                    handleUpdateWorkstreamMilestone(
                      ws.id,
                      'milestone',
                      text
                    )
                  }
                />
                <TextInput
                  style={styles.milestoneDateInput}
                  placeholder="YYYY-MM-DD"
                  value={ws.milestoneDate || ''}
                  onChangeText={(text) =>
                    handleUpdateWorkstreamMilestone(
                      ws.id,
                      'milestoneDate',
                      text
                    )
                  }
                />
              </View>
            ))}
          </View>
        )}

        {/* Task pills */}
        <Text style={styles.selectorLabel}>Tasks</Text>
        <View style={styles.pillRow}>
          {inReviewMode && (
            <SelectorPill
              label="ALL"
              active={!state.activeTaskId}
              onPress={clearTaskSelection}
            />
          )}

          {tasks.length === 0 ? (
            <Text style={styles.cycleMetaSmall}>No tasks yet.</Text>
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

          {/* Add Task pill (requires active workstream) */}
          {state.viewMode !== 'owners' && (
            <Pressable
              style={[
                styles.addPill,
                !state.activeWorkstreamId && styles.addPillDisabled,
              ]}
              onPress={() => {
                if (!state.activeWorkstreamId) {
                  return;
                }
                setIsCreatingTask(true);
              }}
            >
              <Text style={styles.addPillText}>＋ Add task</Text>
            </Pressable>
          )}
        </View>

        {/* New Task entry row */}
        {isCreatingTask && (
          <View style={styles.createRow}>
            <TextInput
              style={styles.createTextInput}
              placeholder="Task name"
              value={newTaskName}
              onChangeText={setNewTaskName}
            />
            <TextInput
              style={styles.createTextInput}
              placeholder="Owner"
              value={newTaskOwner}
              onChangeText={setNewTaskOwner}
            />
            <View style={styles.cadencePickerRow}>
              <Text style={styles.cadencePickerLabel}>Cadence:</Text>
              {(
                [
                  'daily',
                  'weekly',
                  'biweekly',
                  'monthly',
                  'quarterly',
                ] as CadenceType[]
              ).map((c) => (
                <Pressable
                  key={c}
                  style={[
                    styles.cadenceChip,
                    newTaskCadence === c && styles.cadenceChipActive,
                  ]}
                  onPress={() => setNewTaskCadence(c)}
                >
                  <Text
                    style={[
                      styles.cadenceChipText,
                      newTaskCadence === c && styles.cadenceChipTextActive,
                    ]}
                  >
                    {c}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.createActionsRow}>
              <Pressable
                style={styles.createActionPill}
                onPress={handleCreateTask}
              >
                <Text style={styles.createActionPillText}>Add</Text>
              </Pressable>
              <Pressable
                style={styles.createActionPillSecondary}
                onPress={() => {
                  setIsCreatingTask(false);
                  setNewTaskName('');
                  setNewTaskOwner('');
                  setNewTaskCadence('weekly');
                }}
              >
                <Text style={styles.createActionPillSecondaryText}>
                  Cancel
                </Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Active context line (Review only) */}
        {state.viewMode === 'review' &&
          currentTask &&
          currentWs &&
          currentProj && (
            <Text style={styles.nodeSubtitle}>
              Project: {currentProj.name} · Workstream: {currentWs.name} ·
              cadence: {currentWs.cadence}
            </Text>
          )}

        {/* Main content */}
        {state.viewMode === 'review' ? (
          <ReviewSection
            nodes={state.nodes}
            activeProjectId={state.activeProjectId}
            activeWorkstreamId={state.activeWorkstreamId}
            activeTaskId={state.activeTaskId}
            onUpdateField={handleUpdateNodeField}
            onUpdateOwner={handleUpdateNodeOwner}
            onCompleteUpdateForNode={handleCompleteUpdateForNode}
            onRetireNode={handleRetireNode}
            reviewCycleOffset={reviewCycleOffset}
            onChangeReviewCycleOffset={setReviewCycleOffset}
            onCompletePeriodForScope={handleCompletePeriodForScope}
          />
        ) : state.viewMode === 'owners' ? (
          <OwnersOverviewSection
            summary={activeOwnerSummary}
            visibleNodeIds={state.ownerVisibleNodeIds}
            onUpdateField={handleUpdateNodeField}
          />
        ) : (
          <OpenModeSection
            entries={openEntriesFiltered}
            onUpdateField={handleUpdateNodeField}
            onUpdateOwner={handleUpdateNodeOwner}
            onCompleteUpdateForNode={handleCompleteUpdateForNode}
            onRetireNode={handleRetireNode}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ---- Styles ----

const styles = StyleSheet.create({
  debugPill: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#ef9a9a',
    backgroundColor: '#ffebee',
    marginLeft: 8,
  },
  debugPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#b71c1c',
  },

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
    alignItems: 'center',
  },
  // Mode pills – pink active
  modeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
    alignItems: 'center',
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
  // Help pill
  helpPill: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#c5cae9',
    backgroundColor: '#e8eaf6',
  },
  helpPillActive: {
    backgroundColor: '#c5cae9',
    borderColor: '#9fa8da',
  },
  helpPillText: {
    fontSize: 12,
    color: '#283593',
  },
  helpPillTextActive: {
    fontWeight: '600',
    color: '#1a237e',
  },
  // Advanced toggle
  advancedToggle: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#ccc',
    backgroundColor: '#fafafa',
    marginLeft: 'auto',
  },
  advancedToggleActive: {
    backgroundColor: '#fffde7',
    borderColor: '#ffecb3',
  },
  advancedToggleText: {
    fontSize: 12,
    color: '#555',
  },
  advancedToggleTextActive: {
    fontWeight: '600',
    color: '#795548',
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
  // Cadence table styles
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
    flex: 0.8,
    alignItems: 'center',
  },
  pppHeaderText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#444',
  },
  pppHeaderSubText: {
    fontSize: 10,
    color: '#777',
    marginTop: 2,
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
    flex: 0.8,
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
  // Complete Update button
  completeUpdateButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: '#c8e6c9',
    borderWidth: 1,
    borderColor: '#81c784',
    marginBottom: 4,
  },
  completeUpdateButtonDisabled: {
    backgroundColor: '#e0e0e0',
    borderColor: '#bdbdbd',
  },
  completeUpdateButtonText: {
    fontSize: 11,
    color: '#1b5e20',
    fontWeight: '600',
  },
  completeUpdateButtonTextDisabled: {
    color: '#616161',
  },
  // Retire button
  retireButton: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: '#ffebee',
    borderWidth: 1,
    borderColor: '#ef9a9a',
  },
  retireButtonText: {
    fontSize: 11,
    color: '#b71c1c',
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
  // Cycle navigation row
  cycleNavRow: {
    marginTop: 6,
    marginBottom: 4,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  cycleNavText: {
    fontSize: 12,
    color: '#555',
  },
  cycleNavButtons: {
    flexDirection: 'row',
    gap: 6,
  },
  cycleNavButton: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#ccc',
    backgroundColor: '#f5f5f5',
  },
  cycleNavButtonDisabled: {
    opacity: 0.4,
  },
  cycleNavButtonText: {
    fontSize: 11,
    color: '#333',
  },
  cycleNavButtonTextDisabled: {
    color: '#777',
  },
  // Period footer
  periodFooter: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#eee',
    paddingTop: 8,
  },
  periodFooterText: {
    fontSize: 12,
    color: '#555',
    marginBottom: 6,
  },
  completePeriodButton: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: '#c5e1a5',
    borderWidth: 1,
    borderColor: '#9ccc65',
  },
  completePeriodButtonDisabled: {
    backgroundColor: '#eeeeee',
    borderColor: '#bdbdbd',
  },
  completePeriodButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#33691e',
  },
  completePeriodButtonTextDisabled: {
    color: '#757575',
  },
  // Add new pills
  addPill: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: '#ffe0b2',
    borderWidth: 1,
    borderColor: '#ffcc80',
  },
  addPillText: {
    fontSize: 12,
    color: '#e65100',
    fontWeight: '600',
  },
  addPillDisabled: {
    opacity: 0.5,
    backgroundColor: '#f5f5f5',
    borderColor: '#e0e0e0',
  },

  // Create rows
  createRow: {
    marginTop: 4,
    marginBottom: 4,
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#fff3e0',
    borderWidth: 1,
    borderColor: '#ffe0b2',
  },
  createTextInput: {
    fontSize: 13,
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: '#ffcc80',
    borderRadius: 6,
    backgroundColor: '#ffffff',
    marginBottom: 6,
  },
  createActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 4,
  },
  createActionPill: {
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: '#ffe082',
    borderWidth: 1,
    borderColor: '#ffca28',
    minWidth: 60,
    alignItems: 'center',
  },
  createActionPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#e65100',
  },
  createActionPillSecondary: {
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: '#fafafa',
    borderWidth: 1,
    borderColor: '#bdbdbd',
    minWidth: 60,
    alignItems: 'center',
  },
  createActionPillSecondaryText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#616161',
  },
  // Cadence picker
  cadencePickerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  cadencePickerLabel: {
    fontSize: 12,
    color: '#555',
    marginRight: 4,
  },
  cadenceChip: {
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#ffcc80',
    backgroundColor: '#fff8e1',
  },
  cadenceChipActive: {
    backgroundColor: '#ffcc80',
  },
  cadenceChipText: {
    fontSize: 11,
    color: '#e65100',
  },
  cadenceChipTextActive: {
    fontWeight: '600',
    color: '#4e342e',
  },
  // Workstream milestone styles
  milestoneRow: {
    marginTop: 6,
    paddingVertical: 4,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  milestoneWsName: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 2,
  },
  milestoneInput: {
    fontSize: 13,
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: '#cfd8dc',
    borderRadius: 6,
    backgroundColor: '#fafafa',
    marginBottom: 4,
  },
  milestoneDateInput: {
    fontSize: 12,
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: '#cfd8dc',
    borderRadius: 6,
    backgroundColor: '#fafafa',
    width: 120,
  },
  linkText: {
    fontSize: 11,
    color: '#1976d2',
  },
});
