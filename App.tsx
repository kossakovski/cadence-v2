import React, { useEffect, useMemo, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Alert,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import SetupScreen, { OnboardingV1 } from './screens/SetupScreen';

// ------------------------------
// Types
// ------------------------------

type Cadence = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly';
type Screen = 'meeting' | 'manage';
type TaskLifecycle = 'active' | 'inactive';
type MilestoneLifecycle = 'active' | 'inactive';

type ManagePanel = 'milestones' | 'tasks' | 'workstreams';
type ManageAdd = 'none' | 'milestone' | 'task' | 'workstream';

interface Project {
  id: string;
  name: string;
}

interface Workstream {
  id: string;
  projectId: string;
  name: string;
  lead?: string;
  cadence: Cadence;
  firstCycleStartDate: string; // YYYY-MM-DD
}

interface Milestone {
  id: string;
  workstreamId: string;
  title: string;
  dueDate?: string; // YYYY-MM-DD
  lifecycle: MilestoneLifecycle;
  createdAt: string; // YYYY-MM-DD
}

interface Cycle {
  index: number;
  status: 'open' | 'closed';
  startDate: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  previousPlan: string; // derived from prior nextPlan
  actuals: string;
  nextPlan: string;
  owner: string;
  reviewed: boolean;
}

interface Task {
  id: string;
  workstreamId: string;
  milestoneId?: string; // optional linkage (Manage only UI)
  name: string;
  owner: string;
  lifecycle: TaskLifecycle;
  cycles: Cycle[];
  createdAt: string; // YYYY-MM-DD
}

interface AppState {
  projects: Project[];
  workstreams: Workstream[];
  milestones: Milestone[];
  tasks: Task[];
  selectedProjectId?: string;
  selectedWorkstreamId?: string;
}

// ------------------------------
// Storage
// ------------------------------

const STORAGE_KEY = 'cadence_exec_os_mvp_v2';

// ------------------------------
// Date helpers
// ------------------------------

function pad2(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

function toISODate(d: Date): string {
  const year = d.getFullYear();
  const month = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  return `${year}-${month}-${day}`;
}

function parseISODate(s: string): Date {
  const [y, m, d] = s.split('-').map((x) => parseInt(x, 10));
  return new Date(y, (m || 1) - 1, d || 1);
}

function formatHumanDate(iso: string): string {
  const d = parseISODate(iso);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function addMonths(d: Date, months: number): Date {
  const x = new Date(d);
  x.setMonth(x.getMonth() + months);
  return x;
}

function startOfWeekMonday(d: Date): Date {
  const x = new Date(d);
  const day = x.getDay(); // 0 Sun..6 Sat
  const diff = (day + 6) % 7; // Monday=0
  x.setDate(x.getDate() - diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfQuarter(d: Date): Date {
  const x = new Date(d);
  const q = Math.floor(x.getMonth() / 3);
  return new Date(x.getFullYear(), q * 3, 1);
}

function cadenceDefaultStart(today: Date, cadence: Cadence): Date {
  const t = new Date(today);
  t.setHours(0, 0, 0, 0);
  if (cadence === 'daily') return t;
  if (cadence === 'weekly' || cadence === 'biweekly') return startOfWeekMonday(t);
  if (cadence === 'monthly') return new Date(t.getFullYear(), t.getMonth(), 1);
  return startOfQuarter(t);
}

function cadenceIncrement(start: Date, cadence: Cadence, steps: number): Date {
  const x = new Date(start);
  x.setHours(0, 0, 0, 0);
  if (cadence === 'daily') return addDays(x, steps);
  if (cadence === 'weekly') return addDays(x, 7 * steps);
  if (cadence === 'biweekly') return addDays(x, 14 * steps);
  if (cadence === 'monthly') return addMonths(x, steps);
  return addMonths(x, 3 * steps);
}

function getCycleForDate(todayISO: string, firstStartISO: string, cadence: Cadence) {
  const today = parseISODate(todayISO);
  const first = parseISODate(firstStartISO);
  today.setHours(0, 0, 0, 0);
  first.setHours(0, 0, 0, 0);

  if (first.getTime() > today.getTime()) {
    const start = first;
    const next = cadenceIncrement(start, cadence, 1);
    const end = addDays(next, -1);
    return { currentIndex: 0, startISO: toISODate(start), endISO: toISODate(end) };
  }

  let idx = 0;
  let start = new Date(first);
  while (true) {
    const next = cadenceIncrement(start, cadence, 1);
    if (next.getTime() > today.getTime()) {
      const end = addDays(next, -1);
      return { currentIndex: idx, startISO: toISODate(start), endISO: toISODate(end) };
    }
    start = next;
    idx += 1;
    if (idx > 2000) break;
  }

  const next = cadenceIncrement(first, cadence, 1);
  return { currentIndex: 0, startISO: toISODate(first), endISO: toISODate(addDays(next, -1)) };
}

// --- Column header ranges (Prev/Current/Next) ---

function cycleRangeISO(firstStartISO: string, cadence: Cadence, index: number) {
  const start = cadenceIncrement(parseISODate(firstStartISO), cadence, index);
  const next = cadenceIncrement(start, cadence, 1);
  const end = addDays(next, -1);
  return { startISO: toISODate(start), endISO: toISODate(end) };
}

function cycleRangeHuman(firstStartISO: string, cadence: Cadence, index: number) {
  const { startISO, endISO } = cycleRangeISO(firstStartISO, cadence, index);
  return `${formatHumanDate(startISO)}–${formatHumanDate(endISO)}`;
}

function safeTrim(s: string) {
  return (s || '').trim();
}

function uuid(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function isISODateLike(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test((s || '').trim());
}

// ------------------------------
// Hard rules
// ------------------------------

function isReorgAllowed(screen: Screen) {
  return screen === 'manage';
}
function isMeetingActionsAllowed(screen: Screen) {
  return screen === 'meeting';
}

// ------------------------------
// Cycle engine
// ------------------------------

function ensureTaskCyclesUpTo(
  task: Task,
  ownerSnapshot: string,
  cadence: Cadence,
  firstStartISO: string,
  targetIndex: number
) {
  const cycles = [...(task.cycles || [])].sort((a, b) => a.index - b.index);

  for (let i = 0; i <= targetIndex; i++) {
    const existing = cycles.find((c) => c.index === i);
    if (existing) continue;

    const start = cadenceIncrement(parseISODate(firstStartISO), cadence, i);
    const next = cadenceIncrement(start, cadence, 1);
    const end = addDays(next, -1);

    const prev = i === 0 ? '' : safeTrim(cycles.find((c) => c.index === i - 1)?.nextPlan || '');

    cycles.push({
      index: i,
      status: i === targetIndex ? 'open' : 'closed',
      startDate: toISODate(start),
      endDate: toISODate(end),
      previousPlan: prev,
      actuals: '',
      nextPlan: '',
      owner: ownerSnapshot,
      reviewed: false,
    });
  }

  for (const c of cycles) c.status = c.index === targetIndex ? 'open' : 'closed';

  cycles.sort((a, b) => a.index - b.index);
  for (let i = 1; i < cycles.length; i++) {
    cycles[i].previousPlan = safeTrim(cycles[i - 1].nextPlan || '');
  }

  return cycles;
}

// ------------------------------
// Onboarding import
// ------------------------------

function buildStateFromOnboarding(onb: OnboardingV1): AppState {
  const today = new Date();
  const todayISO = toISODate(today);

  const proj0 = onb.projects?.[0] || { name: 'My project', workstreams: [] };
  const projectId = uuid();

  const projects: Project[] = [{ id: projectId, name: safeTrim(proj0.name) || 'My project' }];

  const workstreams: Workstream[] = [];
  const milestones: Milestone[] = [];
  const tasks: Task[] = [];

  for (const ws of proj0.workstreams || []) {
    const cadence = (ws.cadence || 'weekly') as Cadence;
    const firstCycleStartDate = toISODate(cadenceDefaultStart(today, cadence));

    const wsId = uuid();
    workstreams.push({
      id: wsId,
      projectId,
      name: safeTrim(ws.name) || 'Workstream',
      cadence,
      firstCycleStartDate,
      lead: safeTrim(ws.lead || '') || undefined,
    });

    // Back-compat: if onboarding includes a single milestone, create it
    const mTitle = safeTrim((ws as any).milestone || '');
    const mDate = safeTrim((ws as any).milestoneDate || '');
    if (mTitle) {
      milestones.push({
        id: uuid(),
        workstreamId: wsId,
        title: mTitle,
        dueDate: isISODateLike(mDate) ? mDate : undefined,
        lifecycle: 'active',
        createdAt: todayISO,
      });
    }

    for (const t of ws.tasks || []) {
      // IMPORTANT: onboarding should support owners; if absent we default.
      const owner = safeTrim((t as any).owner || '') || 'Unassigned';
      tasks.push({
        id: uuid(),
        workstreamId: wsId,
        name: safeTrim((t as any).name) || 'Task',
        owner,
        lifecycle: 'active',
        cycles: [],
        createdAt: todayISO,
      });
    }
  }

  const selectedWorkstreamId = workstreams[0]?.id;
  return {
    projects,
    workstreams,
    milestones,
    tasks,
    selectedProjectId: projectId,
    selectedWorkstreamId,
  };
}

// ------------------------------
// Small UI atoms
// ------------------------------

function Pill({
  label,
  active,
  onPress,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.pill, active ? styles.pillActive : styles.pillInactive]}>
      <Text style={[styles.pillText, active ? styles.pillTextActive : styles.pillTextInactive]}>{label}</Text>
    </Pressable>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

function SectionTitle({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {right ? <View>{right}</View> : null}
    </View>
  );
}

function SmallMuted({ children, style }: { children: React.ReactNode; style?: any }) {
  return <Text style={[styles.smallMuted, style]}>{children}</Text>;
}

/**
 * Lightweight “type marker” to visually distinguish entity blocks.
 * Uses your warm newspaper palette (no loud neon).
 */

/**
 * Small inline badge for list rows (Manage).
 */


/**
 * Wrapper that adds a subtle left accent bar to a row.
 */
function AccentRow({
  kind,
  children,
  style,
}: {
  kind: 'Workstream' | 'Milestone' | 'Task';
  children: React.ReactNode;
  style?: any;
}) {
  const accent =
    kind === 'Workstream'
      ? styles.accentWS
      : kind === 'Milestone'
      ? styles.accentMS
      : styles.accentTask;
  return (
    <View style={[styles.accentRowOuter, accent, style]}>
      <View style={styles.accentRowInner}>{children}</View>
    </View>
  );
}

// ------------------------------
// App
// ------------------------------

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [screen, setScreen] = useState<Screen>('meeting');
  const [cycleOffset, setCycleOffset] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  // Global filter (applies to all screens)
  const [ownerFilter, setOwnerFilter] = useState<string>('__ALL__'); // '__ALL__' | '__UNASSIGNED__' | ownerName

  // Manage UI state
  const [managePanel, setManagePanel] = useState<ManagePanel>('milestones');
  const [manageAdd, setManageAdd] = useState<ManageAdd>('none');

  // Manage drafts (workstream)
  const [manageDraftWorkstreamName, setManageDraftWorkstreamName] = useState('');
  const [manageDraftWorkstreamCadence, setManageDraftWorkstreamCadence] = useState<Cadence>('weekly');
  const [manageDraftFirstCycleStart, setManageDraftFirstCycleStart] = useState(
    toISODate(startOfWeekMonday(new Date()))
  );

  // Manage drafts (milestones)
  const [manageDraftMilestoneTitle, setManageDraftMilestoneTitle] = useState('');
  const [manageDraftMilestoneDue, setManageDraftMilestoneDue] = useState(''); // YYYY-MM-DD optional

  // Manage drafts (tasks)
  const [manageDraftTaskName, setManageDraftTaskName] = useState('');
  const [manageDraftTaskOwner, setManageDraftTaskOwner] = useState('');
  const [manageDraftTaskMilestoneId, setManageDraftTaskMilestoneId] = useState<string>(''); // '' => none

  // Setup
  const [needsSetup, setNeedsSetup] = useState(false);

  // Follow-up capture (cross-platform fallback uses inline box if Alert.prompt isn't available)
  const [showFollowUpBox, setShowFollowUpBox] = useState(false);
  const [followUpDraft, setFollowUpDraft] = useState('');

  // Meeting view: grouping toggle
  const [meetingGroupByMilestone, setMeetingGroupByMilestone] = useState(true);

  // --- Load / migrate state ---
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!raw) {
          setNeedsSetup(true);
          setState(null);
        } else {
          const parsed = JSON.parse(raw);

          // Migrate: milestones + milestoneId
          const migrated: AppState = {
            projects: Array.isArray(parsed.projects) ? parsed.projects : [],
            workstreams: Array.isArray(parsed.workstreams) ? parsed.workstreams : [],
            tasks: Array.isArray(parsed.tasks)
              ? parsed.tasks.map((t: any) => ({
                  ...t,
                  milestoneId: t.milestoneId || undefined,
                  cycles: Array.isArray(t.cycles) ? t.cycles : [],
                }))
              : [],
            milestones: Array.isArray(parsed.milestones) ? parsed.milestones : [],
            selectedProjectId: parsed.selectedProjectId,
            selectedWorkstreamId: parsed.selectedWorkstreamId,
          };

          setState(migrated);
        }
      } catch {
        setNeedsSetup(true);
        setState(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!state) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
  }, [state]);

  const todayISO = useMemo(() => toISODate(new Date()), []);

  const selectedProject = useMemo(() => {
    if (!state?.selectedProjectId) return undefined;
    return state.projects.find((p) => p.id === state.selectedProjectId);
  }, [state]);

  const selectedWorkstream = useMemo(() => {
    if (!state?.selectedWorkstreamId) return undefined;
    return state.workstreams.find((w) => w.id === state.selectedWorkstreamId);
  }, [state]);

  const workstreamsInProject = useMemo(() => {
    if (!state?.selectedProjectId) return [];
    return state.workstreams.filter((w) => w.projectId === state.selectedProjectId);
  }, [state]);

  const tasksInSelectedWorkstream = useMemo(() => {
    if (!state?.selectedWorkstreamId) return [];
    return state.tasks
      .filter((t) => t.workstreamId === state.selectedWorkstreamId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [state]);

  const milestonesInSelectedWorkstream = useMemo(() => {
    if (!state?.selectedWorkstreamId) return [];
    return (state.milestones || [])
      .filter((m) => m.workstreamId === state.selectedWorkstreamId)
      .sort((a, b) => (a.dueDate || '9999-99-99').localeCompare(b.dueDate || '9999-99-99'));
  }, [state]);

  const activeMilestones = useMemo(
    () => milestonesInSelectedWorkstream.filter((m) => m.lifecycle === 'active'),
    [milestonesInSelectedWorkstream]
  );

  const milestoneById = useMemo(() => {
    const map = new Map<string, Milestone>();
    for (const m of state?.milestones || []) map.set(m.id, m);
    return map;
  }, [state]);

  const ownerOptions = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasksInSelectedWorkstream) {
      const o = safeTrim(t.owner || '');
      if (o) set.add(o);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [tasksInSelectedWorkstream]);

  // Auto-reset filter if selected workstream changes and filter no longer valid
  useEffect(() => {
    if (ownerFilter === '__ALL__' || ownerFilter === '__UNASSIGNED__') return;
    if (!ownerOptions.includes(ownerFilter)) setOwnerFilter('__ALL__');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.selectedWorkstreamId]);

  // Also: when switching to Manage, default to "Milestones" and close any open add panel
  useEffect(() => {
    if (screen !== 'manage') return;
    setManageAdd('none');
    if (!state?.selectedWorkstreamId) setManagePanel('workstreams');
    else setManagePanel((p) => p || 'milestones');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  const cycleInfo = useMemo(() => {
    if (!selectedWorkstream) return null;
    return getCycleForDate(todayISO, selectedWorkstream.firstCycleStartDate, selectedWorkstream.cadence);
  }, [selectedWorkstream, todayISO]);

  const viewedCycleIndex = useMemo(() => {
    if (!cycleInfo) return 0;
    return Math.max(0, cycleInfo.currentIndex - cycleOffset);
  }, [cycleInfo, cycleOffset]);

  const viewedPeriodLabel = useMemo(() => {
    if (!selectedWorkstream || !cycleInfo) return '';
    const cadence = selectedWorkstream.cadence;
    const start = cadenceIncrement(parseISODate(selectedWorkstream.firstCycleStartDate), cadence, viewedCycleIndex);
    const next = cadenceIncrement(start, cadence, 1);
    const end = addDays(next, -1);
    return `${formatHumanDate(toISODate(start))} – ${formatHumanDate(toISODate(end))}`;
  }, [selectedWorkstream, cycleInfo, viewedCycleIndex]);

  const columnRanges = useMemo(() => {
    if (!selectedWorkstream) return null;
    const first = selectedWorkstream.firstCycleStartDate;
    const cad = selectedWorkstream.cadence;

    const curr = cycleRangeHuman(first, cad, viewedCycleIndex);
    const next = cycleRangeHuman(first, cad, viewedCycleIndex + 1);

    return { curr, next };
  }, [selectedWorkstream, viewedCycleIndex]);

  const milestoneSummary = useMemo(() => {
    if (!selectedWorkstream) return null;
    const active = activeMilestones;
    if (active.length === 0) return null;

    const withDue = active
      .filter((m) => !!m.dueDate)
      .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
    const nextDue = withDue[0];

    return {
      count: active.length,
      nextDue: nextDue ? `${nextDue.title}${nextDue.dueDate ? ` (by ${formatHumanDate(nextDue.dueDate)})` : ''}` : null,
    };
  }, [selectedWorkstream, activeMilestones]);

  // Ensure tasks have cycles up to current index
  useEffect(() => {
    if (!state || !selectedWorkstream || !cycleInfo) return;
    const currentIndex = cycleInfo.currentIndex;

    let changed = false;
    const newTasks = state.tasks.map((t) => {
      if (t.workstreamId !== selectedWorkstream.id) return t;
      const maxIdx = (t.cycles || []).reduce((m, c) => Math.max(m, c.index), -1);
      if (maxIdx >= currentIndex) return t;

      changed = true;
      return {
        ...t,
        cycles: ensureTaskCyclesUpTo(
          t,
          t.owner,
          selectedWorkstream.cadence,
          selectedWorkstream.firstCycleStartDate,
          currentIndex
        ),
      };
    });

    if (changed) setState({ ...state, tasks: newTasks });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.tasks?.length, selectedWorkstream?.id, cycleInfo?.currentIndex]);

  const ownerPasses = (task: Task) => {
    if (ownerFilter === '__ALL__') return true;
    if (ownerFilter === '__UNASSIGNED__') {
      return safeTrim(task.owner || '').length === 0 || safeTrim(task.owner) === 'Unassigned';
    }
    return safeTrim(task.owner || '') === ownerFilter;
  };

  // Milestone task counts (for Manage)
  const milestoneCounts = useMemo(() => {
    const map = new Map<
      string,
      { active: number; total: number; activeFiltered: number; totalFiltered: number }
    >();

    const wsId = state?.selectedWorkstreamId;
    if (!wsId || !state) return map;

    for (const m of milestonesInSelectedWorkstream) {
      map.set(m.id, { active: 0, total: 0, activeFiltered: 0, totalFiltered: 0 });
    }

    const tasksInWS = state.tasks.filter((t) => t.workstreamId === wsId);

    for (const t of tasksInWS) {
      if (!t.milestoneId) continue;
      const bucket = map.get(t.milestoneId);
      if (!bucket) continue;

      bucket.total += 1;
      if (t.lifecycle === 'active') bucket.active += 1;

      if (ownerPasses(t)) {
        bucket.totalFiltered += 1;
        if (t.lifecycle === 'active') bucket.activeFiltered += 1;
      }
    }

    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.tasks, state?.selectedWorkstreamId, milestonesInSelectedWorkstream, ownerFilter]);

  const viewedTasks = useMemo(() => {
    if (!selectedWorkstream) return [];
    return tasksInSelectedWorkstream
      .filter((t) => ownerPasses(t))
      .map((t) => {
        const cyc = (t.cycles || []).find((c) => c.index === viewedCycleIndex);
        return { task: t, cycle: cyc };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasksInSelectedWorkstream, selectedWorkstream, viewedCycleIndex, ownerFilter]);

  const activeViewed = useMemo(() => viewedTasks.filter((x) => x.task.lifecycle === 'active'), [viewedTasks]);

  const readiness = useMemo(() => {
    if (cycleOffset !== 0) return null;
    const total = activeViewed.length;
    const prepared = activeViewed.filter(
      (x) => safeTrim(x.cycle?.actuals || '').length > 0 && safeTrim(x.cycle?.nextPlan || '').length > 0
    ).length;
    return { total, prepared, missing: total - prepared };
  }, [activeViewed, cycleOffset]);

  const allReviewedCurrent = useMemo(() => {
    if (cycleOffset !== 0) return false;
    if (activeViewed.length === 0) return false;
    return activeViewed.every((x) => x.cycle?.reviewed === true);
  }, [activeViewed, cycleOffset]);

  const canClosePeriod = useMemo(() => {
    return isMeetingActionsAllowed(screen) && cycleOffset === 0 && allReviewedCurrent;
  }, [screen, cycleOffset, allReviewedCurrent]);

  // ✅ FIX: Meeting grouping buckets computed at top-level (no hooks inside renderMeeting)
  const meetingBuckets = useMemo(() => {
    // Only relevant when meeting + grouped, but memo is safe to compute always.
    const activeRows = activeViewed;
    const map = new Map<string, { milestone: Milestone | null; rows: { task: Task; cycle?: Cycle }[] }>();

    // Pre-seed active milestone buckets (keeps stable ordering by due date)
    for (const m of activeMilestones) {
      map.set(m.id, { milestone: m, rows: [] });
    }
    // Always include a "none" bucket at end
    map.set('__NONE__', { milestone: null, rows: [] });

    for (const r of activeRows) {
      const mid =
        r.task.milestoneId && milestoneById.get(r.task.milestoneId)?.lifecycle === 'active'
          ? r.task.milestoneId
          : undefined;
      const key = mid || '__NONE__';
      if (!map.has(key)) map.set(key, { milestone: mid ? milestoneById.get(mid) || null : null, rows: [] });
      map.get(key)!.rows.push(r);
    }

    // Turn into ordered list: active milestones (due-date order), then __NONE__ if it has items
    const ordered: { milestone: Milestone | null; rows: { task: Task; cycle?: Cycle }[] }[] = [];
    for (const m of activeMilestones) {
      const bucket = map.get(m.id);
      if (bucket && bucket.rows.length > 0) ordered.push(bucket);
    }
    const noneBucket = map.get('__NONE__');
    if (noneBucket && noneBucket.rows.length > 0) ordered.push(noneBucket);

    return ordered;
  }, [activeViewed, activeMilestones, milestoneById]);

  // ------------------------------
  // Setup completion
  // ------------------------------

  function handleSetupComplete(onb: OnboardingV1) {
    const next = buildStateFromOnboarding(onb);
    setState(next);
    setNeedsSetup(false);
    setScreen('meeting');
    setCycleOffset(0);
    setOwnerFilter('__ALL__');
  }

  // ------------------------------
  // Mutations
  // ------------------------------

  function setSelectedProject(projectId: string) {
    if (!state) return;
    const ws = state.workstreams.find((w) => w.projectId === projectId);
    setState({ ...state, selectedProjectId: projectId, selectedWorkstreamId: ws ? ws.id : undefined });
    setCycleOffset(0);
    setOwnerFilter('__ALL__');
  }

  function setSelectedWorkstream(workstreamId: string) {
    if (!state) return;
    setState({ ...state, selectedWorkstreamId: workstreamId });
    setCycleOffset(0);
    setOwnerFilter('__ALL__');
  }

  function updateCycleField(taskId: string, cycleIndex: number, patch: Partial<Cycle>) {
    if (!state) return;
    const newTasks = state.tasks.map((t) => {
      if (t.id !== taskId) return t;
      const cycles = (t.cycles || []).map((c) => (c.index !== cycleIndex ? c : { ...c, ...patch }));
      cycles.sort((a, b) => a.index - b.index);
      for (let i = 1; i < cycles.length; i++) cycles[i].previousPlan = safeTrim(cycles[i - 1].nextPlan || '');
      return { ...t, cycles };
    });
    setState({ ...state, tasks: newTasks });
  }

  function actuallyAddFollowUp(nameRaw: string) {
    if (!state || !selectedWorkstream || !cycleInfo) return;
    const name = safeTrim(nameRaw);
    if (!name) return;

    const nextIndex = cycleInfo.currentIndex + 1;
    const owner = 'Unassigned';

    const task: Task = {
      id: uuid(),
      workstreamId: selectedWorkstream.id,
      name,
      owner,
      lifecycle: 'active',
      cycles: [],
      createdAt: toISODate(new Date()),
    };

    task.cycles = ensureTaskCyclesUpTo(
      task,
      owner,
      selectedWorkstream.cadence,
      selectedWorkstream.firstCycleStartDate,
      nextIndex
    );

    setState({ ...state, tasks: [...state.tasks, task] });
  }

  function captureFollowUpInMeeting() {
    if (!state || !selectedWorkstream || !cycleInfo) return;
    if (!isMeetingActionsAllowed(screen)) return;

    // Best UX where supported
    if (typeof (Alert as any).prompt === 'function' && Platform.OS !== 'web') {
      (Alert as any).prompt(
        'Capture follow-up',
        'Enter an action item (it will start next period).',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Add', onPress: (text?: string) => actuallyAddFollowUp(text || '') },
        ],
        'plain-text'
      );
      return;
    }

    // Cross-platform fallback: inline box (web + android + anything else)
    setShowFollowUpBox(true);
  }

  function closeCurrentPeriod() {
    if (!state || !selectedWorkstream || !cycleInfo) return;
    if (!canClosePeriod) return;

    const nextIndex = cycleInfo.currentIndex + 1;
    const updatedTasks = state.tasks.map((t) => {
      if (t.workstreamId !== selectedWorkstream.id) return t;
      if (t.lifecycle !== 'active') return t;
      const cycles = ensureTaskCyclesUpTo(
        t,
        t.owner,
        selectedWorkstream.cadence,
        selectedWorkstream.firstCycleStartDate,
        nextIndex
      );
      return { ...t, cycles };
    });

    setState({ ...state, tasks: updatedTasks });
    Alert.alert('Period closed', 'Opened the next period for this workstream.');
    setCycleOffset(0);
  }

  // ------------------------------
  // Manage actions: Workstreams
  // ------------------------------

  function manageCreateWorkstream() {
    if (!state || !state.selectedProjectId) return;
    if (!isReorgAllowed(screen)) return;

    const name = safeTrim(manageDraftWorkstreamName);
    if (!name) return;

    const ws: Workstream = {
      id: uuid(),
      projectId: state.selectedProjectId,
      name,
      cadence: manageDraftWorkstreamCadence,
      firstCycleStartDate: manageDraftFirstCycleStart,
    };

    setState({ ...state, workstreams: [...state.workstreams, ws], selectedWorkstreamId: ws.id });
    setManageDraftWorkstreamName('');
    setOwnerFilter('__ALL__');
  }

  // ------------------------------
  // Manage actions: Milestones
  // ------------------------------

  function manageCreateMilestone() {
    if (!state || !state.selectedWorkstreamId) return;
    if (!isReorgAllowed(screen)) return;

    const title = safeTrim(manageDraftMilestoneTitle);
    if (!title) return;

    const due = safeTrim(manageDraftMilestoneDue);
    const today = toISODate(new Date());

    const m: Milestone = {
      id: uuid(),
      workstreamId: state.selectedWorkstreamId,
      title,
      dueDate: due && isISODateLike(due) ? due : undefined,
      lifecycle: 'active',
      createdAt: today,
    };

    setState({ ...state, milestones: [...(state.milestones || []), m] });
    setManageDraftMilestoneTitle('');
    setManageDraftMilestoneDue('');
  }

  function manageUpdateMilestone(milestoneId: string, patch: Partial<Milestone>) {
    if (!state) return;
    if (!isReorgAllowed(screen)) return;
    setState({
      ...state,
      milestones: (state.milestones || []).map((m) => (m.id === milestoneId ? { ...m, ...patch } : m)),
    });
  }

  function manageRetireMilestone(milestoneId: string) {
    if (!state) return;
    if (!isReorgAllowed(screen)) return;

    setState({
      ...state,
      milestones: (state.milestones || []).map((m) => (m.id === milestoneId ? { ...m, lifecycle: 'inactive' } : m)),
      tasks: state.tasks.map((t) => (t.milestoneId === milestoneId ? { ...t, milestoneId: undefined } : t)),
    });
  }

  function manageReactivateMilestone(milestoneId: string) {
    manageUpdateMilestone(milestoneId, { lifecycle: 'active' });
  }

  // ------------------------------
  // Manage actions: Tasks
  // ------------------------------

  function manageCreateTask() {
    if (!state || !state.selectedWorkstreamId) return;
    if (!isReorgAllowed(screen)) return;

    const name = safeTrim(manageDraftTaskName);
    if (!name) return;

    const owner = safeTrim(manageDraftTaskOwner) || 'Unassigned';
    const milestoneId = safeTrim(manageDraftTaskMilestoneId);
    const pickedMilestoneId = milestoneId ? milestoneId : undefined;

    if (pickedMilestoneId) {
      const m = milestoneById.get(pickedMilestoneId);
      if (!m || m.lifecycle !== 'active') return;
    }

    const today = toISODate(new Date());
    let task: Task = {
      id: uuid(),
      workstreamId: state.selectedWorkstreamId,
      milestoneId: pickedMilestoneId,
      name,
      owner,
      lifecycle: 'active',
      cycles: [],
      createdAt: today,
    };

    if (selectedWorkstream && cycleInfo) {
      task = {
        ...task,
        cycles: ensureTaskCyclesUpTo(
          task,
          owner,
          selectedWorkstream.cadence,
          selectedWorkstream.firstCycleStartDate,
          cycleInfo.currentIndex
        ),
      };
    }

    setState({ ...state, tasks: [...state.tasks, task] });
    setManageDraftTaskName('');
    setManageDraftTaskOwner('');
    setManageDraftTaskMilestoneId('');
  }

  function manageRenameTask(taskId: string, newName: string) {
    if (!state) return;
    if (!isReorgAllowed(screen)) return;
    const name = safeTrim(newName);
    if (!name) return;
    setState({ ...state, tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, name } : t)) });
  }

  function manageChangeOwner(taskId: string, owner: string) {
    if (!state) return;
    if (!isReorgAllowed(screen)) return;
    setState({
      ...state,
      tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, owner: safeTrim(owner) || 'Unassigned' } : t)),
    });
  }

  function manageSetTaskMilestone(taskId: string, milestoneId?: string) {
    if (!state) return;
    if (!isReorgAllowed(screen)) return;

    if (milestoneId) {
      const m = milestoneById.get(milestoneId);
      if (!m || m.lifecycle !== 'active') return;
    }

    setState({
      ...state,
      tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, milestoneId } : t)),
    });
  }

  function manageRetireTask(taskId: string) {
    if (!state) return;
    if (!isReorgAllowed(screen)) return;
    setState({ ...state, tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, lifecycle: 'inactive' } : t)) });
  }

  function manageReactivateTask(taskId: string) {
    if (!state) return;
    if (!isReorgAllowed(screen)) return;
    setState({ ...state, tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, lifecycle: 'active' } : t)) });
  }

  async function manageResetToSetup_NO_CONFIRM() {
    await AsyncStorage.removeItem(STORAGE_KEY);
    setState(null);
    setNeedsSetup(true);
  }

  function manageResetToSetup_WITH_CONFIRM() {
  if (!isReorgAllowed(screen)) return;

  const msg =
    'This will erase all local data on this device (projects, workstreams, milestones, tasks, and history) and re-run the Setup Wizard.\n\nContinue?';

  if (Platform.OS === 'web') {
    // RN Web: Alert.alert may be a no-op; use browser confirm.
    const ok = window.confirm(msg);
    if (ok) manageResetToSetup_NO_CONFIRM().catch(() => {});
    return;
  }

  Alert.alert('Reset Cadence?', msg, [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Reset',
      style: 'destructive',
      onPress: () => manageResetToSetup_NO_CONFIRM().catch(() => {}),
    },
  ]);
}


  // ------------------------------
  // Render helpers (NO HOOKS INSIDE)
  // ------------------------------

  function renderOwnerFilter() {
    if (!state?.selectedWorkstreamId) return null;

    const allCount = tasksInSelectedWorkstream.filter((t) => t.lifecycle === 'active').length;
    const unassignedCount = tasksInSelectedWorkstream.filter(
      (t) => t.lifecycle === 'active' && (safeTrim(t.owner) === '' || safeTrim(t.owner) === 'Unassigned')
    ).length;

    return (
      <View style={{ marginTop: 10, gap: 6 }}>
        <SmallMuted>Owner</SmallMuted>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.inlineRow}>
            <Pill
              label={`All (${allCount})`}
              active={ownerFilter === '__ALL__'}
              onPress={() => setOwnerFilter('__ALL__')}
            />
            <Pill
              label={`Unassigned (${unassignedCount})`}
              active={ownerFilter === '__UNASSIGNED__'}
              onPress={() => setOwnerFilter('__UNASSIGNED__')}
            />
            {ownerOptions.map((o) => {
              const count = tasksInSelectedWorkstream.filter(
                (t) => t.lifecycle === 'active' && safeTrim(t.owner) === o
              ).length;
              return (
                <Pill
                  key={o}
                  label={`${o} (${count})`}
                  active={ownerFilter === o}
                  onPress={() => setOwnerFilter(o)}
                />
              );
            })}
          </View>
        </ScrollView>
      </View>
    );
  }

  function renderTopNav() {
    return (
      <View style={styles.topNav}>
        <View style={styles.topNavRow}>
          <Text style={styles.appTitle}>Cadence</Text>
          <View style={styles.topNavPills}>
            <Pill label="Meeting" active={screen === 'meeting'} onPress={() => setScreen('meeting')} />
            <Pill label="Manage" active={screen === 'manage'} onPress={() => setScreen('manage')} />
          </View>
        </View>

        <View style={styles.scopeRow}>
          <View style={styles.scopeBlock}>
            <SmallMuted>Project</SmallMuted>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.inlineRow}>
                {state?.projects.map((p) => (
                  <Pill
                    key={p.id}
                    label={p.name}
                    active={p.id === state?.selectedProjectId}
                    onPress={() => setSelectedProject(p.id)}
                  />
                ))}
              </View>
            </ScrollView>
          </View>

          <View style={styles.scopeBlock}>
            <SmallMuted>Workstream</SmallMuted>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.inlineRow}>
                {workstreamsInProject.map((w) => (
                  <Pill
                    key={w.id}
                    label={w.name}
                    active={w.id === state?.selectedWorkstreamId}
                    onPress={() => setSelectedWorkstream(w.id)}
                  />
                ))}
              </View>
            </ScrollView>
          </View>

          {renderOwnerFilter()}
        </View>
      </View>
    );
  }

  function renderPeriodNavigator() {
    // Manage is “real-time only”: no time navigation arrows, no past-cycle browsing here.
    if (screen === 'manage') return null;
    if (!selectedWorkstream || !cycleInfo) return null;

    const canGoBack = viewedCycleIndex > 0;
    const canGoForward = cycleOffset > 0;

    return (
      <View style={styles.periodNav}>
        <Pressable
          style={[styles.navBtn, !canGoBack ? styles.navBtnDisabled : null]}
          disabled={!canGoBack}
          onPress={() => setCycleOffset((x) => x + 1)}
        >
          <Text style={styles.navBtnText}>◀</Text>
        </Pressable>

        <View style={styles.periodCenter}>
          <Text style={styles.periodTitle}>Cadence Meeting</Text>
          <Text style={styles.periodSub}>{viewedPeriodLabel}</Text>

          {milestoneSummary ? (
            <Text style={styles.periodHint}>
              Milestones: {milestoneSummary.count}
              {milestoneSummary.nextDue ? ` • Next: ${milestoneSummary.nextDue}` : ''}
            </Text>
          ) : (
            <Text style={styles.periodHint}>Milestones: none yet (add in Manage)</Text>
          )}

          {cycleOffset > 0 ? <Text style={styles.periodHint}>Past period (read-only)</Text> : null}
        </View>

        <Pressable
          style={[styles.navBtn, !canGoForward ? styles.navBtnDisabled : null]}
          disabled={!canGoForward}
          onPress={() => setCycleOffset((x) => Math.max(0, x - 1))}
        >
          <Text style={styles.navBtnText}>▶</Text>
        </Pressable>
      </View>
    );
  }

  function renderPPPHeader() {
    const curr = columnRanges ? ` (${columnRanges.curr})` : '';
    const next = columnRanges ? ` (${columnRanges.next})` : '';

    return (
      <View style={styles.pppHeader}>
        <Text style={[styles.pppCol, styles.pppCol1]}>Item / Owner</Text>
        <Text style={[styles.pppCol, styles.pppCol2]}>What we said{curr}</Text>
        <Text style={[styles.pppCol, styles.pppCol3]}>What happened{curr}</Text>
        <Text style={[styles.pppCol, styles.pppCol4]}>What’s next{next}</Text>
        {screen === 'meeting' ? <Text style={[styles.pppCol, styles.pppCol5]}>Reviewed</Text> : null}
      </View>
    );
  }

  function renderTaskRow(x: { task: Task; cycle?: Cycle }) {
    const { task, cycle } = x;
    const isPast = cycleOffset > 0;
    const isCurrent = cycleOffset === 0;

    // Pre-meeting removed; Meeting can soft-edit current cycle
    const canSoftEditMeeting = screen === 'meeting' && isCurrent && task.lifecycle === 'active';

    const actualsMissing = safeTrim(cycle?.actuals || '').length === 0;
    const nextMissing = safeTrim(cycle?.nextPlan || '').length === 0;
    const showNotUpdated =
      screen === 'meeting' && isCurrent && task.lifecycle === 'active' && (actualsMissing || nextMissing);

    const canEditActuals = canSoftEditMeeting;
    const canEditNext = canSoftEditMeeting;

    return (
      <View key={task.id} style={[styles.row, task.lifecycle !== 'active' ? styles.rowInactive : null]}>
        <View style={styles.cell1}>
          <Text style={styles.taskName}>{task.name}</Text>
          <Text style={styles.taskMeta}>{safeTrim(task.owner) ? task.owner : 'Unassigned'}</Text>
          {showNotUpdated ? <Text style={styles.badgeWarn}>Not updated yet</Text> : null}
          {task.lifecycle !== 'active' ? <Text style={styles.badgeMuted}>Inactive</Text> : null}
        </View>

        <View style={styles.cell2}>
          <Text style={styles.lockedText}>{cycle?.previousPlan || ''}</Text>
        </View>

        <View style={styles.cell3}>
          {canEditActuals ? (
            <TextInput
              value={cycle?.actuals || ''}
              onChangeText={(t) => updateCycleField(task.id, viewedCycleIndex, { actuals: t })}
              placeholder="Soft edit…"
              style={styles.textArea}
              multiline
            />
          ) : (
            <Text style={styles.plainText}>{cycle?.actuals || ''}</Text>
          )}
        </View>

        <View style={styles.cell4}>
          {canEditNext ? (
            <TextInput
              value={cycle?.nextPlan || ''}
              onChangeText={(t) => updateCycleField(task.id, viewedCycleIndex, { nextPlan: t })}
              placeholder="Soft edit…"
              style={styles.textArea}
              multiline
            />
          ) : (
            <Text style={styles.plainText}>{cycle?.nextPlan || ''}</Text>
          )}
        </View>

        {screen === 'meeting' ? (
          <View style={styles.cell5}>
            {isPast ? (
              <Text style={styles.mutedCenter}>{cycle?.reviewed ? '✓' : ''}</Text>
            ) : task.lifecycle !== 'active' ? (
              <Text style={styles.mutedCenter}>—</Text>
            ) : (
              <Pressable
                style={[styles.reviewBtn, cycle?.reviewed ? styles.reviewBtnOn : styles.reviewBtnOff]}
                onPress={() => updateCycleField(task.id, viewedCycleIndex, { reviewed: !cycle?.reviewed })}
              >
                <Text style={styles.reviewBtnText}>{cycle?.reviewed ? 'Reviewed' : 'Mark'}</Text>
              </Pressable>
            )}
          </View>
        ) : null}
      </View>
    );
  }

  function renderMilestoneHeader(m: Milestone | null, counts?: { n: number }) {
    const title = m ? m.title : 'No milestone';
    const due = m?.dueDate ? formatHumanDate(m.dueDate) : null;
    const rightBits: string[] = [];
    if (due) rightBits.push(`Due ${due}`);
    if (counts) rightBits.push(`${counts.n} item${counts.n === 1 ? '' : 's'}`);

    return (
      <View style={styles.msGroupHeader}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          
            <Text style={styles.msGroupTitle}>{title}</Text>
          </View>
          {rightBits.length > 0 ? <Text style={styles.msGroupMeta}>{rightBits.join(' • ')}</Text> : null}
        </View>
      </View>
    );
  }

  function renderMeeting() {
    if (!selectedWorkstream) {
      return (
        <Card>
          <Text style={styles.h1}>No workstream selected</Text>
          <SmallMuted>Choose a project and workstream above.</SmallMuted>
        </Card>
      );
    }

    const activeRows = activeViewed;
    const inactiveRows = viewedTasks.filter((x) => x.task.lifecycle !== 'active');

    return (
      <>
        <Card>
          {readiness && cycleOffset === 0 ? (
            <View style={styles.readinessRow}>
              <View>
                <Text style={styles.h2}>Readiness</Text>
                <Text style={styles.readinessText}>
                  Prepared: <Text style={styles.bold}>{readiness.prepared}</Text> of{' '}
                  <Text style={styles.bold}>{readiness.total}</Text>
                </Text>
                {readiness.missing > 0 ? (
                  <Text style={styles.readinessWarn}>{readiness.missing} tasks still need updates</Text>
                ) : (
                  <Text style={styles.readinessOk}>All tasks prepared</Text>
                )}
              </View>

              <View style={{ alignItems: 'flex-end', minWidth: 240 }}>
                <Pressable style={styles.captureBtn} onPress={captureFollowUpInMeeting}>
                  <Text style={styles.captureBtnText}>＋ Capture follow-up</Text>
                </Pressable>
                <SmallMuted>Starts next period</SmallMuted>

                {showFollowUpBox ? (
                  <View style={styles.followUpBox}>
                    <TextInput
                      value={followUpDraft}
                      onChangeText={setFollowUpDraft}
                      placeholder="Type follow-up…"
                      style={styles.followUpInput}
                    />
                    <View style={styles.followUpRow}>
                      <Pressable
                        style={[
                          styles.primaryBtn,
                          safeTrim(followUpDraft).length === 0 ? styles.primaryBtnDisabled : null,
                        ]}
                        disabled={safeTrim(followUpDraft).length === 0}
                        onPress={() => {
                          actuallyAddFollowUp(followUpDraft);
                          setFollowUpDraft('');
                          setShowFollowUpBox(false);
                        }}
                      >
                        <Text style={styles.primaryBtnText}>Add</Text>
                      </Pressable>
                      <Pressable
                        style={styles.secondaryBtn}
                        onPress={() => {
                          setFollowUpDraft('');
                          setShowFollowUpBox(false);
                        }}
                      >
                        <Text style={styles.secondaryBtnText}>Cancel</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}
              </View>
            </View>
          ) : null}

          <SmallMuted>
  Meeting actions: edit Actuals/Next, after discussion mark items reviewed. Reorg happens in Manage.
</SmallMuted>
        </Card>

        <Card>
          <SectionTitle
            title="Active items"
            right={
              <View style={{ alignItems: 'flex-end', gap: 8 }}>
                <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
                  <Pill label="By milestone" active={meetingGroupByMilestone} onPress={() => setMeetingGroupByMilestone(true)} />
                  <Pill label="One list" active={!meetingGroupByMilestone} onPress={() => setMeetingGroupByMilestone(false)} />
                </View>

                {cycleOffset === 0 ? (
                  <Pressable
                    style={[styles.primaryBtn, !canClosePeriod ? styles.primaryBtnDisabled : null]}
                    disabled={!canClosePeriod}
                    onPress={closeCurrentPeriod}
                  >
                    <Text style={styles.primaryBtnText}>Close period</Text>
                  </Pressable>
                ) : null}
              </View>
            }
          />

          {meetingGroupByMilestone ? (
            <>
              {activeRows.length === 0 ? <Text style={styles.smallMuted}>No active tasks (for this owner filter).</Text> : null}

              {meetingBuckets.map((bucket) => (
                <View key={bucket.milestone?.id || '__NONE__'} style={{ marginTop: 10 }}>
                  {renderMilestoneHeader(bucket.milestone, { n: bucket.rows.length })}
                  {renderPPPHeader()}
                  {bucket.rows.map(renderTaskRow)}
                </View>
              ))}

              {cycleOffset === 0 && !allReviewedCurrent ? (
                <Text style={styles.helpText}>To close: mark all active items as reviewed.</Text>
              ) : null}
            </>
          ) : (
            <>
              {renderPPPHeader()}
              {activeRows.length === 0 ? <Text style={styles.smallMuted}>No active tasks (for this owner filter).</Text> : null}
              {activeRows.map(renderTaskRow)}
              {cycleOffset === 0 && !allReviewedCurrent ? (
                <Text style={styles.helpText}>To close: mark all active items as reviewed.</Text>
              ) : null}
            </>
          )}
        </Card>

        {inactiveRows.length > 0 ? (
          <Card>
            <SectionTitle title="Inactive (read-only)" />
            {renderPPPHeader()}
            {inactiveRows.map(renderTaskRow)}
          </Card>
        ) : null}
      </>
    );
  }

  // ------------------------------
  // Manage screen (cleaner)
  // ------------------------------

  function renderManage() {
    if (!state) return null;

    const wsId = state.selectedWorkstreamId;

    const tasksInWSFiltered = wsId
      ? state.tasks
          .filter((t) => t.workstreamId === wsId)
          .filter((t) => ownerPasses(t))
          .sort((a, b) => a.name.localeCompare(b.name))
      : [];

    const activeTasks = tasksInWSFiltered.filter((t) => t.lifecycle === 'active');
    const inactiveTasks = tasksInWSFiltered.filter((t) => t.lifecycle !== 'active');

    const activeMs = activeMilestones;
    const inactiveMs = milestonesInSelectedWorkstream.filter((m) => m.lifecycle !== 'active');

    const workstreamsList = state.selectedProjectId
      ? state.workstreams
          .filter((w) => w.projectId === state.selectedProjectId)
          .sort((a, b) => a.name.localeCompare(b.name))
      : [];

    const renderManageHeader = () => (
      <Card>
        <Text style={styles.h2}>Manage</Text>
        <SmallMuted>
          Reorg happens only here: workstreams, milestones, create/rename tasks, owner changes, retire/reactivate,
          task→milestone linking. (Owner filter applies here too.)
        </SmallMuted>

        <View style={{ marginTop: 12 }}>
          <SmallMuted style={{ marginBottom: 6 }}>View</SmallMuted>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.inlineRow}>
              <Pill
  label="Workstreams"
  active={managePanel === 'workstreams'}
  onPress={() => {
    setManagePanel('workstreams');
    setManageAdd('none');
  }}
/>
<Pill
  label="Milestones"
  active={managePanel === 'milestones'}
  onPress={() => {
    setManagePanel('milestones');
    setManageAdd('none');
  }}
/>
<Pill
  label="Tasks"
  active={managePanel === 'tasks'}
  onPress={() => {
    setManagePanel('tasks');
    setManageAdd('none');
  }}
/>

            </View>
          </ScrollView>
        </View>

        <View style={{ marginTop: 12 }}>
          <SmallMuted style={{ marginBottom: 6 }}>Add</SmallMuted>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.inlineRow}>
              <Pill
                label="+ Workstream"
                active={manageAdd === 'workstream'}
                onPress={() => setManageAdd((x) => (x === 'workstream' ? 'none' : 'workstream'))}
              />
              <Pill
                label="+ Milestone"
                active={manageAdd === 'milestone'}
                onPress={() => setManageAdd((x) => (x === 'milestone' ? 'none' : 'milestone'))}
              />
              <Pill
                label="+ Task"
                active={manageAdd === 'task'}
                onPress={() => setManageAdd((x) => (x === 'task' ? 'none' : 'task'))}
              />
            </View>
          </ScrollView>

          <View style={{ marginTop: 10 }}>
            <Pressable style={styles.dangerBtn} onPress={manageResetToSetup_WITH_CONFIRM}>
              <Text style={styles.dangerBtnText}>Reset / run Setup Wizard</Text>
            </Pressable>
          </View>
        </View>
      </Card>
    );

    const renderAddWorkstream = () => (
      <Card>
        <SectionTitle title="Add workstream" />

        <SmallMuted>Cadence is defined at the workstream level (tasks inherit).</SmallMuted>

        <View style={styles.formRow}>
          <TextInput
            value={manageDraftWorkstreamName}
            onChangeText={setManageDraftWorkstreamName}
            placeholder="Workstream name"
            style={styles.input}
          />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.inlineRow}>
            {(['daily', 'weekly', 'biweekly', 'monthly', 'quarterly'] as Cadence[]).map((c) => (
              <Pill
                key={c}
                label={c}
                active={manageDraftWorkstreamCadence === c}
                onPress={() => setManageDraftWorkstreamCadence(c)}
              />
            ))}
          </View>
        </ScrollView>

        <View style={styles.formRow}>
          <TextInput
            value={manageDraftFirstCycleStart}
            onChangeText={setManageDraftFirstCycleStart}
            placeholder="First cycle start (YYYY-MM-DD)"
            style={styles.input}
            autoCapitalize="none"
          />
          <Pressable
            style={[
              styles.primaryBtn,
              safeTrim(manageDraftWorkstreamName).length === 0 ? styles.primaryBtnDisabled : null,
            ]}
            onPress={() => {
              manageCreateWorkstream();
              setManageAdd('none');
              setManagePanel('workstreams');
            }}
            disabled={safeTrim(manageDraftWorkstreamName).length === 0}
          >
            <Text style={styles.primaryBtnText}>Create</Text>
          </Pressable>
        </View>
      </Card>
    );

    const renderAddMilestone = () => (
      <Card>
        <SectionTitle title="Add milestone"/>
        {!wsId ? (
          <SmallMuted>Select a workstream above.</SmallMuted>
        ) : (
          <>
            <SmallMuted>Milestones live under the selected workstream.</SmallMuted>
            <View style={styles.formRow}>
              <TextInput
                value={manageDraftMilestoneTitle}
                onChangeText={setManageDraftMilestoneTitle}
                placeholder="Milestone title"
                style={styles.input}
              />
              <TextInput
                value={manageDraftMilestoneDue}
                onChangeText={setManageDraftMilestoneDue}
                placeholder="Due date (YYYY-MM-DD, optional)"
                style={styles.input}
                autoCapitalize="none"
              />
            </View>

            <Pressable
              style={[
                styles.primaryBtn,
                safeTrim(manageDraftMilestoneTitle).length === 0 ? styles.primaryBtnDisabled : null,
              ]}
              onPress={() => {
                manageCreateMilestone();
                setManageAdd('none');
                setManagePanel('milestones');
              }}
              disabled={safeTrim(manageDraftMilestoneTitle).length === 0}
            >
              <Text style={styles.primaryBtnText}>Add milestone</Text>
            </Pressable>
          </>
        )}
      </Card>
    );

    const renderAddTask = () => (
      <Card>
        <SectionTitle title="Add task"/>
        {!wsId ? (
          <SmallMuted>Select a workstream above.</SmallMuted>
        ) : (
          <>
            <SmallMuted>Create tasks here. Optionally link to a milestone.</SmallMuted>

            <View style={styles.formRow}>
              <TextInput
                value={manageDraftTaskName}
                onChangeText={setManageDraftTaskName}
                placeholder="Task name"
                style={styles.input}
              />
              <TextInput
                value={manageDraftTaskOwner}
                onChangeText={setManageDraftTaskOwner}
                placeholder="Owner (optional)"
                style={styles.input}
              />
            </View>

            <SmallMuted style={{ marginTop: 4 }}>Milestone (optional)</SmallMuted>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }}>
              <View style={styles.inlineRow}>
                <Pill
                  label="None"
                  active={safeTrim(manageDraftTaskMilestoneId).length === 0}
                  onPress={() => setManageDraftTaskMilestoneId('')}
                />
                {activeMilestones.map((m) => (
                  <Pill
                    key={m.id}
                    label={m.title}
                    active={manageDraftTaskMilestoneId === m.id}
                    onPress={() => setManageDraftTaskMilestoneId(m.id)}
                  />
                ))}
              </View>
            </ScrollView>

            <Pressable
              style={[styles.primaryBtn, safeTrim(manageDraftTaskName).length === 0 ? styles.primaryBtnDisabled : null]}
              onPress={() => {
                manageCreateTask();
                setManageAdd('none');
                setManagePanel('tasks');
              }}
              disabled={safeTrim(manageDraftTaskName).length === 0}
            >
              <Text style={styles.primaryBtnText}>Add task</Text>
            </Pressable>
          </>
        )}
      </Card>
    );

    const renderWorkstreamsPanel = () => (
      <Card>
        <SectionTitle title="Workstreams"/>
        {workstreamsList.length === 0 ? <SmallMuted>No workstreams yet.</SmallMuted> : null}

        {workstreamsList.map((w) => (
          <AccentRow key={w.id} kind="Workstream">
            <View style={styles.manageRowBody}>
              
              <View style={{ flex: 1 }}>
                <Text style={styles.taskName}>{w.name}</Text>
                <Text style={styles.taskMeta}>
                  Cadence: {w.cadence} • First:{' '}
                  {isISODateLike(w.firstCycleStartDate) ? formatHumanDate(w.firstCycleStartDate) : w.firstCycleStartDate}
                </Text>
                {w.id === wsId ? <Text style={styles.badgeWarn}>Selected</Text> : null}
              </View>
              <Pressable
                style={styles.secondaryBtn}
                onPress={() => {
                  setSelectedWorkstream(w.id);
                  setManagePanel('milestones');
                  setManageAdd('none');
                }}
              >
                <Text style={styles.secondaryBtnText}>Select</Text>
              </Pressable>
            </View>
          </AccentRow>
        ))}
      </Card>
    );

    const renderMilestonesPanel = () => (
      <>
        <Card>
          <SectionTitle title="Milestones"/>
          {!wsId ? <SmallMuted>Select a workstream above.</SmallMuted> : null}

          {wsId ? (
            <>
              <SmallMuted>
                Task counts shown as <Text style={styles.bold}>filtered/total</Text> active tasks. (Filtered respects Owner pills.)
              </SmallMuted>

              {activeMs.length > 0 ? <Text style={styles.h3}>Active</Text> : null}
              {activeMs.map((m) => {
                const c = milestoneCounts.get(m.id);
                const countsLabel = c ? `${c.activeFiltered}/${c.active} active` : '0/0 active';
                return (
                  <AccentRow key={m.id} kind="Milestone">
                    <View style={styles.manageRowBody}>
                      
                      <View style={{ flex: 1, gap: 6 }}>
                        {Platform.OS === 'web' ? (
                          <>
                            <TextInput
                              value={m.title}
                              onChangeText={(t) => manageUpdateMilestone(m.id, { title: safeTrim(t) || m.title })}
                              style={styles.input}
                            />
                            <TextInput
                              value={m.dueDate || ''}
                              onChangeText={(t) =>
                                manageUpdateMilestone(m.id, {
                                  dueDate: safeTrim(t) && isISODateLike(t) ? safeTrim(t) : undefined,
                                })
                              }
                              placeholder="Due date (YYYY-MM-DD)"
                              style={styles.input}
                              autoCapitalize="none"
                            />
                            <Text style={styles.taskMeta}>
                              Due: {m.dueDate ? formatHumanDate(m.dueDate) : '—'} • Tasks: {countsLabel}
                            </Text>
                            <SmallMuted>Edits save immediately on web.</SmallMuted>
                          </>
                        ) : (
                          <>
                            <Text style={styles.taskName}>{m.title}</Text>
                            <Text style={styles.taskMeta}>
                              Due: {m.dueDate ? formatHumanDate(m.dueDate) : '—'} • Tasks: {countsLabel}
                            </Text>
                          </>
                        )}
                      </View>

                      {Platform.OS !== 'web' ? (
                        <>
                          <Pressable
                            style={styles.secondaryBtn}
                            onPress={() => {
                              (Alert as any).prompt?.('Rename milestone', 'New title:', [
                                { text: 'Cancel', style: 'cancel' },
                                {
                                  text: 'Save',
                                  onPress: (text?: string) =>
                                    manageUpdateMilestone(m.id, { title: safeTrim(text || '') || m.title }),
                                },
                              ]);
                              if (Platform.OS === 'android') Alert.alert('Rename', 'Android: prompt not available in this MVP.');
                            }}
                          >
                            <Text style={styles.secondaryBtnText}>Rename</Text>
                          </Pressable>

                          <Pressable
                            style={styles.secondaryBtn}
                            onPress={() => {
                              (Alert as any).prompt?.('Milestone due date', 'YYYY-MM-DD (leave blank to clear):', [
                                { text: 'Cancel', style: 'cancel' },
                                {
                                  text: 'Save',
                                  onPress: (text?: string) => {
                                    const v = safeTrim(text || '');
                                    manageUpdateMilestone(m.id, { dueDate: v && isISODateLike(v) ? v : undefined });
                                  },
                                },
                              ]);
                              if (Platform.OS === 'android') Alert.alert('Due date', 'Android: prompt not available in this MVP.');
                            }}
                          >
                            <Text style={styles.secondaryBtnText}>Due</Text>
                          </Pressable>
                        </>
                      ) : null}

                      <Pressable style={styles.dangerBtn} onPress={() => manageRetireMilestone(m.id)}>
                        <Text style={styles.dangerBtnText}>Retire</Text>
                      </Pressable>
                    </View>
                  </AccentRow>
                );
              })}

              {inactiveMs.length > 0 ? <Text style={styles.h3}>Inactive</Text> : null}
              {inactiveMs.map((m) => {
                const c = milestoneCounts.get(m.id);
                const countsLabel = c ? `${c.activeFiltered}/${c.active} active` : '0/0 active';
                return (
                  <AccentRow key={m.id} kind="Milestone">
                    <View style={styles.manageRowBody}>
                      
                      <View style={{ flex: 1 }}>
                        <Text style={styles.taskName}>{m.title}</Text>
                        <Text style={styles.taskMeta}>
                          Due: {m.dueDate ? formatHumanDate(m.dueDate) : '—'} • Tasks: {countsLabel}
                        </Text>
                        <Text style={styles.badgeMuted}>Inactive</Text>
                      </View>
                      <Pressable style={styles.secondaryBtn} onPress={() => manageReactivateMilestone(m.id)}>
                        <Text style={styles.secondaryBtnText}>Reactivate</Text>
                      </Pressable>
                    </View>
                  </AccentRow>
                );
              })}
            </>
          ) : null}
        </Card>

        {/* When in Milestones view, ALSO keep the Active task list visible for linking */}
        {wsId ? (
          <Card>
            <SectionTitle title="Active tasks (link to milestones)"/>
            <SmallMuted>Use the milestone pills on each task row. (Owner filter applies.)</SmallMuted>
            {activeTasks.length === 0 ? <Text style={styles.smallMuted}>No active tasks (for this owner filter).</Text> : null}
            {activeTasks.map((t) => {
              const assigned = t.milestoneId ? milestoneById.get(t.milestoneId) : undefined;
              return (
                <AccentRow key={t.id} kind="Task">
                  <View style={styles.manageRowBody}>
                    
                    <View style={{ flex: 1, gap: 6 }}>
                      {Platform.OS === 'web' ? (
                        <>
                          <TextInput
                            value={t.name}
                            onChangeText={(txt) => manageRenameTask(t.id, txt)}
                            style={styles.input}
                            placeholder="Task name"
                          />
                          <TextInput
                            value={t.owner}
                            onChangeText={(txt) => manageChangeOwner(t.id, txt)}
                            style={styles.input}
                            placeholder="Owner"
                          />
                        </>
                      ) : (
                        <>
                          <Text style={styles.taskName}>{t.name}</Text>
                          <Text style={styles.taskMeta}>Owner: {safeTrim(t.owner) ? t.owner : 'Unassigned'}</Text>
                        </>
                      )}

                      <View style={{ gap: 6 }}>
                        <SmallMuted>Milestone</SmallMuted>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                          <View style={styles.inlineRow}>
                            <Pill label="None" active={!t.milestoneId} onPress={() => manageSetTaskMilestone(t.id, undefined)} />
                            {activeMilestones.map((m) => (
                              <Pill key={m.id} label={m.title} active={t.milestoneId === m.id} onPress={() => manageSetTaskMilestone(t.id, m.id)} />
                            ))}
                          </View>
                        </ScrollView>
                        {assigned && assigned.lifecycle !== 'active' ? (
                          <Text style={styles.badgeWarn}>Assigned milestone is inactive (auto-cleared when retiring)</Text>
                        ) : null}
                      </View>
                    </View>

                    <Pressable style={styles.dangerBtn} onPress={() => manageRetireTask(t.id)}>
                      <Text style={styles.dangerBtnText}>Retire</Text>
                    </Pressable>
                  </View>
                </AccentRow>
              );
            })}
          </Card>
        ) : null}
      </>
    );

    const renderTasksPanel = () => (
      <Card>
        <SectionTitle title="Tasks"/>
        {!wsId ? (
          <SmallMuted>Select a workstream above.</SmallMuted>
        ) : (
          <SmallMuted>Rename, owner changes, retire/reactivate, and milestone linking.</SmallMuted>
        )}

        {wsId ? (
          <>
            {activeTasks.length > 0 ? <Text style={styles.h3}>Active</Text> : null}
            {activeTasks.map((t) => {
              const assigned = t.milestoneId ? milestoneById.get(t.milestoneId) : undefined;
              return (
                <AccentRow key={t.id} kind="Task">
                  <View style={styles.manageRowBody}>
                    
                    <View style={{ flex: 1, gap: 6 }}>
                      {Platform.OS === 'web' ? (
                        <>
                          <TextInput
                            value={t.name}
                            onChangeText={(txt) => manageRenameTask(t.id, txt)}
                            style={styles.input}
                            placeholder="Task name"
                          />
                          <TextInput
                            value={t.owner}
                            onChangeText={(txt) => manageChangeOwner(t.id, txt)}
                            style={styles.input}
                            placeholder="Owner"
                          />
                        </>
                      ) : (
                        <>
                          <Text style={styles.taskName}>{t.name}</Text>
                          <Text style={styles.taskMeta}>Owner: {safeTrim(t.owner) ? t.owner : 'Unassigned'}</Text>
                        </>
                      )}

                      <View style={{ gap: 6 }}>
                        <SmallMuted>Milestone</SmallMuted>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                          <View style={styles.inlineRow}>
                            <Pill label="None" active={!t.milestoneId} onPress={() => manageSetTaskMilestone(t.id, undefined)} />
                            {activeMilestones.map((m) => (
                              <Pill key={m.id} label={m.title} active={t.milestoneId === m.id} onPress={() => manageSetTaskMilestone(t.id, m.id)} />
                            ))}
                          </View>
                        </ScrollView>
                        {assigned && assigned.lifecycle !== 'active' ? (
                          <Text style={styles.badgeWarn}>Assigned milestone is inactive (auto-cleared when retiring)</Text>
                        ) : null}
                      </View>
                    </View>

                    {Platform.OS !== 'web' ? (
                      <>
                        <Pressable
                          style={styles.secondaryBtn}
                          onPress={() => {
                            (Alert as any).prompt?.('Rename task', 'New name:', [
                              { text: 'Cancel', style: 'cancel' },
                              { text: 'Save', onPress: (text?: string) => manageRenameTask(t.id, text || '') },
                            ]);
                            if (Platform.OS === 'android') Alert.alert('Rename', 'Android: rename prompt not available in this MVP.');
                          }}
                        >
                          <Text style={styles.secondaryBtnText}>Rename</Text>
                        </Pressable>

                        <Pressable
                          style={styles.secondaryBtn}
                          onPress={() => {
                            (Alert as any).prompt?.('Change owner', 'Owner name:', [
                              { text: 'Cancel', style: 'cancel' },
                              { text: 'Save', onPress: (text?: string) => manageChangeOwner(t.id, text || '') },
                            ]);
                            if (Platform.OS === 'android') Alert.alert('Owner', 'Android: owner prompt not available in this MVP.');
                          }}
                        >
                          <Text style={styles.secondaryBtnText}>Owner</Text>
                        </Pressable>
                      </>
                    ) : null}

                    <Pressable style={styles.dangerBtn} onPress={() => manageRetireTask(t.id)}>
                      <Text style={styles.dangerBtnText}>Retire</Text>
                    </Pressable>
                  </View>
                </AccentRow>
              );
            })}

            {inactiveTasks.length > 0 ? <Text style={styles.h3}>Inactive</Text> : null}
            {inactiveTasks.map((t) => (
              <AccentRow key={t.id} kind="Task">
                <View style={styles.manageRowBody}>
                  
                  <View style={{ flex: 1 }}>
                    <Text style={styles.taskName}>{t.name}</Text>
                    <Text style={styles.taskMeta}>Owner: {safeTrim(t.owner) ? t.owner : 'Unassigned'}</Text>
                    <Text style={styles.badgeMuted}>Inactive</Text>
                  </View>
                  <Pressable style={styles.secondaryBtn} onPress={() => manageReactivateTask(t.id)}>
                    <Text style={styles.secondaryBtnText}>Reactivate</Text>
                  </Pressable>
                </View>
              </AccentRow>
            ))}
          </>
        ) : null}
      </Card>
    );

    return (
      <>
        {renderManageHeader()}

        {manageAdd === 'workstream' ? renderAddWorkstream() : null}
        {manageAdd === 'milestone' ? renderAddMilestone() : null}
        {manageAdd === 'task' ? renderAddTask() : null}

        {managePanel === 'workstreams' ? renderWorkstreamsPanel() : null}
        {managePanel === 'milestones' ? renderMilestonesPanel() : null}
        {managePanel === 'tasks' ? renderTasksPanel() : null}
      </>
    );
  }

  // ------------------------------
  // Render
  // ------------------------------

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.h2}>Loading…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (needsSetup || !state) {
    return (
      <SafeAreaView style={[styles.safe, { padding: 12 }]}>
        <ScrollView>
          {/* Tiny onboarding change: explicitly request owners as part of the input */}
          <Card>
            <Text style={styles.h2}>Setup</Text>
            <SmallMuted>
              When listing tasks for the LLM onboarding, please include an <Text style={styles.bold}>Owner</Text> for each
              task (e.g., “Define scope — Dmitri”). If omitted, tasks will default to “Unassigned.”
            </SmallMuted>
          </Card>

          <SetupScreen onComplete={handleSetupComplete} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  // (Selected project is currently unused in rendering, but kept for state model stability)
  void selectedProject;

  return (
    <SafeAreaView style={styles.safe}>
      {renderTopNav()}
      <ScrollView contentContainerStyle={styles.container}>
        {renderPeriodNavigator()}
        {screen === 'meeting' ? renderMeeting() : null}
        {screen === 'manage' ? renderManage() : null}
        <View style={{ height: 36 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ------------------------------
// Styles (NEWSPAPER feel: warm light background, dark ink)
// ------------------------------

const PAPER = '#fbf6ea';
const INK = '#1b1b1e';
const MUTED = '#5b5b66';
const BORDER = '#e6dcc7';
const CARD = '#fffdf6';
const SOFT = '#f3ead6';
const BTN_TEXT = '#fbf6ea';

// Subtle tints (still in the newspaper palette)
const WS_TINT = '#eaf1fb'; // cool parchment-blue
const MS_TINT = '#fbf1e2'; // warm parchment-amber
const TASK_TINT = '#eef7ee'; // calm parchment-green

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: PAPER },
  container: { padding: 12, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  appTitle: { color: INK, fontSize: 18, fontWeight: '700' },

  topNav: { padding: 12, paddingTop: 10, backgroundColor: PAPER, borderBottomWidth: 1, borderBottomColor: BORDER },
  topNavRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  topNavPills: { flexDirection: 'row', gap: 8 },

  scopeRow: { marginTop: 10, gap: 10 },
  scopeBlock: { gap: 6 },
  inlineRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },

  pill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  pillActive: { backgroundColor: INK, borderColor: INK },
  pillInactive: { backgroundColor: CARD, borderColor: BORDER },
  pillText: { fontSize: 13, fontWeight: '700' },
  pillTextActive: { color: BTN_TEXT },
  pillTextInactive: { color: INK },

  card: { backgroundColor: CARD, borderRadius: 16, padding: 12, borderWidth: 1, borderColor: BORDER },

  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 8 },
  sectionTitle: { color: INK, fontSize: 15, fontWeight: '800' },

  h1: { color: INK, fontSize: 18, fontWeight: '900' },
  h2: { color: INK, fontSize: 16, fontWeight: '900' },
  h3: { color: INK, fontSize: 14, fontWeight: '900', marginTop: 10, marginBottom: 6 },

  smallMuted: { color: MUTED, fontSize: 12, lineHeight: 16 },
  helpText: { color: MUTED, fontSize: 12, marginTop: 8 },

  periodNav: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  navBtn: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
  },
  navBtnDisabled: { opacity: 0.4 },
  navBtnText: { color: INK, fontSize: 16, fontWeight: '900' },
  periodCenter: { flex: 1, alignItems: 'center', gap: 2 },
  periodTitle: { color: INK, fontSize: 16, fontWeight: '900' },
  periodSub: { color: INK, fontSize: 13, fontWeight: '700' },
  periodHint: { color: MUTED, fontSize: 12, textAlign: 'center' },

  readinessRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 8 },
  readinessText: { color: INK, fontSize: 13, marginTop: 4 },
  readinessWarn: { color: '#8a4b00', fontSize: 13, marginTop: 2, fontWeight: '900' },
  readinessOk: { color: '#1f6f3f', fontSize: 13, marginTop: 2, fontWeight: '900' },
  bold: { fontWeight: '900' },

  captureBtn: { backgroundColor: INK, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, marginTop: 2 },
  captureBtnText: { color: BTN_TEXT, fontWeight: '900' },

  followUpBox: { marginTop: 10, width: 260 },
  followUpInput: { padding: 10, borderRadius: 12, backgroundColor: PAPER, borderWidth: 1, borderColor: BORDER, color: INK },
  followUpRow: { flexDirection: 'row', gap: 8, marginTop: 8, justifyContent: 'flex-end' },

  pppHeader: { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: BORDER },
  pppCol: { color: MUTED, fontSize: 12, fontWeight: '900' },
  pppCol1: { flex: 1.0, paddingRight: 8 },
  pppCol2: { flex: 1.4, paddingRight: 8 },
  pppCol3: { flex: 1.4, paddingRight: 8 },
  pppCol4: { flex: 1.4, paddingRight: 8 },
  pppCol5: { width: 92, textAlign: 'center' },

  row: { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: BORDER },
  rowInactive: { opacity: 0.55 },

  cell1: { flex: 1.0, paddingRight: 8, gap: 4 },
  cell2: { flex: 1.4, paddingRight: 8 },
  cell3: { flex: 1.4, paddingRight: 8 },
  cell4: { flex: 1.4, paddingRight: 8 },
  cell5: { width: 92, alignItems: 'center', justifyContent: 'center' },

  taskName: { color: INK, fontSize: 13, fontWeight: '900' },
  taskMeta: { color: MUTED, fontSize: 12, fontWeight: '700' },

  badgeWarn: {
    alignSelf: 'flex-start',
    backgroundColor: SOFT,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    color: '#8a4b00',
    fontSize: 11,
    fontWeight: '900',
  },
  badgeMuted: {
    alignSelf: 'flex-start',
    backgroundColor: SOFT,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    color: MUTED,
    fontSize: 11,
    fontWeight: '900',
  },

  lockedText: { color: INK, fontSize: 12, lineHeight: 16 },
  plainText: { color: INK, fontSize: 12, lineHeight: 16 },

  textArea: {
    minHeight: 48,
    maxHeight: 160,
    padding: 8,
    borderRadius: 12,
    backgroundColor: PAPER,
    borderWidth: 1,
    borderColor: BORDER,
    color: INK,
    fontSize: 12,
    lineHeight: 16,
  },

  input: { flex: 1, padding: 10, borderRadius: 12, backgroundColor: PAPER, borderWidth: 1, borderColor: BORDER, color: INK },

  formRow: { flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: 8, marginBottom: 8 },

  primaryBtn: { backgroundColor: INK, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryBtnText: { color: BTN_TEXT, fontWeight: '900' },

  secondaryBtn: { backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12, marginLeft: 8 },
  secondaryBtnText: { color: INK, fontWeight: '900', fontSize: 12 },

  dangerBtn: { backgroundColor: '#ffe8ea', borderWidth: 1, borderColor: '#f3b6bf', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12, marginTop: 8 },
  dangerBtnText: { color: '#7a1b2b', fontWeight: '900', fontSize: 12 },

  reviewBtn: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12, borderWidth: 1, width: 84, alignItems: 'center' },
  reviewBtnOn: { backgroundColor: '#e6f3ea', borderColor: '#9fd0ae' },
  reviewBtnOff: { backgroundColor: CARD, borderColor: BORDER },
  reviewBtnText: { color: INK, fontWeight: '900', fontSize: 12 },
  mutedCenter: { color: MUTED, fontWeight: '900' },

  // ---- Distinguish kinds (Manage) ----
  kindTag: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  kindTagText: { color: INK, fontWeight: '900', fontSize: 11 },
  kindWS: { backgroundColor: WS_TINT, borderColor: '#cfdcf4' },
  kindMS: { backgroundColor: MS_TINT, borderColor: '#efd8b6' },
  kindTask: { backgroundColor: TASK_TINT, borderColor: '#cfe3cf' },

  typeBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 2,
  },
  typeBadgeText: { color: INK, fontWeight: '900', fontSize: 10 },
  typeBadgeWS: { backgroundColor: WS_TINT, borderColor: '#cfdcf4' },
  typeBadgeMS: { backgroundColor: MS_TINT, borderColor: '#efd8b6' },
  typeBadgeTask: { backgroundColor: TASK_TINT, borderColor: '#cfe3cf' },

  accentRowOuter: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
    marginTop: 10,
  },
  accentRowInner: {
    padding: 10,
  },
  accentWS: {
    borderLeftWidth: 6,
    borderLeftColor: '#9bb7e6',
    backgroundColor: '#f7faff',
  },
  accentMS: {
    borderLeftWidth: 6,
    borderLeftColor: '#d9a85b',
    backgroundColor: '#fffaf2',
  },
  accentTask: {
    borderLeftWidth: 6,
    borderLeftColor: '#6fb38a',
    backgroundColor: '#f6fbf6',
  },

  manageRowBody: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },

  // Meeting milestone grouping header
  msGroupHeader: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
    marginBottom: 8,
  },
  msGroupTitle: { color: INK, fontSize: 13, fontWeight: '900' },
  msGroupMeta: { color: MUTED, fontSize: 12, fontWeight: '700', marginTop: 4 },
});
