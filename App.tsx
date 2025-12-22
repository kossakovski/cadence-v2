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
type Screen = 'meeting' | 'owners' | 'manage';
type TaskLifecycle = 'active' | 'inactive';

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
  milestone?: string;
  milestoneDate?: string; // YYYY-MM-DD
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
  name: string;
  owner: string;
  lifecycle: TaskLifecycle;
  cycles: Cycle[];
  createdAt: string; // YYYY-MM-DD
}

interface AppState {
  projects: Project[];
  workstreams: Workstream[];
  tasks: Task[];
  selectedProjectId?: string;
  selectedWorkstreamId?: string;
}

// ------------------------------
// Storage
// ------------------------------

const STORAGE_KEY = 'cadence_exec_os_mvp_v2'; // bump key so you can compare behaviors safely

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

function safeTrim(s: string) {
  return (s || '').trim();
}

function uuid(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// ------------------------------
// Hard rules
// ------------------------------

function isReorgAllowed(screen: Screen) {
  return screen === 'manage';
}
function isOwnerAddAllowed(screen: Screen) {
  return screen === 'owners';
}
function isOwnerEditAllowed(screen: Screen) {
  return screen === 'owners';
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
  const cycles = [...task.cycles].sort((a, b) => a.index - b.index);

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
// Onboarding import (Option B)
// ------------------------------

function buildStateFromOnboarding(onb: OnboardingV1): AppState {
  const today = new Date();
  const todayISO = toISODate(today);

  const proj0 = onb.projects?.[0] || { name: 'My project', workstreams: [] };
  const projectId = uuid();

  const projects: Project[] = [{ id: projectId, name: safeTrim(proj0.name) || 'My project' }];

  const workstreams: Workstream[] = [];
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

      // ✅ capture milestone fields if present
      lead: safeTrim(ws.lead || '') || undefined,
      milestone: safeTrim(ws.milestone || '') || undefined,
      milestoneDate: safeTrim(ws.milestoneDate || '') || undefined,
    });

    for (const t of ws.tasks || []) {
      const owner = safeTrim(t.owner || '') || 'Unassigned';
      tasks.push({
        id: uuid(),
        workstreamId: wsId,
        name: safeTrim(t.name) || 'Task',
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
      <Text style={[styles.pillText, active ? styles.pillTextActive : styles.pillTextInactive]}>
        {label}
      </Text>
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

function SmallMuted({ children }: { children: React.ReactNode }) {
  return <Text style={styles.smallMuted}>{children}</Text>;
}

// ------------------------------
// App
// ------------------------------

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [screen, setScreen] = useState<Screen>('meeting'); // default Meeting
  const [cycleOffset, setCycleOffset] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  const [newTaskName, setNewTaskName] = useState('');
  const [newTaskOwner, setNewTaskOwner] = useState('');

  // Manage drafts
  const [manageDraftProjectName, setManageDraftProjectName] = useState('');
  const [manageDraftWorkstreamName, setManageDraftWorkstreamName] = useState('');
  const [manageDraftWorkstreamCadence, setManageDraftWorkstreamCadence] = useState<Cadence>('weekly');
  const [manageDraftFirstCycleStart, setManageDraftFirstCycleStart] = useState(
    toISODate(startOfWeekMonday(new Date()))
  );

  // ✅ if no persisted state, show SetupScreen
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!raw) {
          setNeedsSetup(true);
          setState(null);
        } else {
          setState(JSON.parse(raw));
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

  // Ensure tasks have cycles up to current index
  useEffect(() => {
    if (!state || !selectedWorkstream || !cycleInfo) return;
    const currentIndex = cycleInfo.currentIndex;

    let changed = false;
    const newTasks = state.tasks.map((t) => {
      if (t.workstreamId !== selectedWorkstream.id) return t;
      const maxIdx = t.cycles.reduce((m, c) => Math.max(m, c.index), -1);
      if (maxIdx >= currentIndex) return t;

      changed = true;
      return {
        ...t,
        cycles: ensureTaskCyclesUpTo(t, t.owner, selectedWorkstream.cadence, selectedWorkstream.firstCycleStartDate, currentIndex),
      };
    });

    if (changed) setState({ ...state, tasks: newTasks });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.tasks?.length, selectedWorkstream?.id, cycleInfo?.currentIndex]);

  const viewedTasks = useMemo(() => {
    if (!selectedWorkstream) return [];
    return tasksInSelectedWorkstream.map((t) => {
      const cyc = t.cycles.find((c) => c.index === viewedCycleIndex);
      return { task: t, cycle: cyc };
    });
  }, [tasksInSelectedWorkstream, selectedWorkstream, viewedCycleIndex]);

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

  // ------------------------------
  // Setup completion
  // ------------------------------

  function handleSetupComplete(onb: OnboardingV1) {
    const next = buildStateFromOnboarding(onb);
    setState(next);
    setNeedsSetup(false);
    setScreen('meeting');
    setCycleOffset(0);
  }

  // ------------------------------
  // Mutations
  // ------------------------------

  function setSelectedProject(projectId: string) {
    if (!state) return;
    const ws = state.workstreams.find((w) => w.projectId === projectId);
    setState({ ...state, selectedProjectId: projectId, selectedWorkstreamId: ws ? ws.id : undefined });
    setCycleOffset(0);
  }

  function setSelectedWorkstream(workstreamId: string) {
    if (!state) return;
    setState({ ...state, selectedWorkstreamId: workstreamId });
    setCycleOffset(0);
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

  function addTaskOwnerPrep() {
    if (!state || !selectedWorkstream) return;
    if (!isOwnerAddAllowed(screen)) return;

    const name = safeTrim(newTaskName);
    const owner = safeTrim(newTaskOwner) || 'Unassigned';
    if (!name) return;

    const today = toISODate(new Date());
    const task: Task = {
      id: uuid(),
      workstreamId: selectedWorkstream.id,
      name,
      owner,
      lifecycle: 'active',
      cycles: [],
      createdAt: today,
    };

    if (cycleInfo) {
      task.cycles = ensureTaskCyclesUpTo(
        task,
        owner,
        selectedWorkstream.cadence,
        selectedWorkstream.firstCycleStartDate,
        cycleInfo.currentIndex
      );
    }

    setState({ ...state, tasks: [...state.tasks, task] });
    setNewTaskName('');
    setNewTaskOwner('');
  }

  function captureFollowUpInMeeting() {
    if (!state || !selectedWorkstream || !cycleInfo) return;
    if (!isMeetingActionsAllowed(screen)) return;

    Alert.prompt?.(
      'Capture follow-up',
      'Enter an action item (it will start next period).',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Add',
          onPress: (text?: string) => {

            const name = safeTrim(text || '');
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
          },
        },
      ],
      'plain-text'
    );

    if (Platform.OS === 'android') {
      Alert.alert('Capture follow-up', 'On Android, please add follow-ups in Owners view for now.');
    }
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
  // Manage actions (reorg-only)
  // ------------------------------

  function manageCreateProject() {
    if (!state) return;
    if (!isReorgAllowed(screen)) return;

    const name = safeTrim(manageDraftProjectName);
    if (!name) return;

    const p: Project = { id: uuid(), name };
    setState({ ...state, projects: [...state.projects, p], selectedProjectId: p.id, selectedWorkstreamId: undefined });
    setManageDraftProjectName('');
  }

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

  async function manageResetToSetup() {
    if (!isReorgAllowed(screen)) return;
    await AsyncStorage.removeItem(STORAGE_KEY);
    setState(null);
    setNeedsSetup(true);
  }

  // ------------------------------
  // Render helpers
  // ------------------------------

  function renderTopNav() {
    return (
      <View style={styles.topNav}>
        <View style={styles.topNavRow}>
          <Text style={styles.appTitle}>Cadence</Text>
          <View style={styles.topNavPills}>
            <Pill label="Meeting" active={screen === 'meeting'} onPress={() => setScreen('meeting')} />
            <Pill label="Owners" active={screen === 'owners'} onPress={() => setScreen('owners')} />
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
        </View>
      </View>
    );
  }

  function renderPeriodNavigator() {
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
          <Text style={styles.periodTitle}>
            {screen === 'meeting' ? 'Weekly Cadence Meeting' : screen === 'owners' ? 'Owner Prep' : 'Manage (Backstage)'}
          </Text>
          <Text style={styles.periodSub}>{viewedPeriodLabel}</Text>

          {/* ✅ show milestone context if present */}
          {selectedWorkstream.milestone ? (
            <Text style={styles.periodHint}>
              Milestone: {selectedWorkstream.milestone}
              {selectedWorkstream.milestoneDate ? ` (by ${selectedWorkstream.milestoneDate})` : ''}
            </Text>
          ) : null}

          {screen === 'meeting' && cycleOffset === 0 ? (
            <Text style={styles.periodHint}>Expectation: task owners update before the meeting.</Text>
          ) : null}
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
    return (
      <View style={styles.pppHeader}>
        <Text style={[styles.pppCol, styles.pppCol1]}>Item / Owner</Text>
        <Text style={[styles.pppCol, styles.pppCol2]}>What we said</Text>
        <Text style={[styles.pppCol, styles.pppCol3]}>What happened</Text>
        <Text style={[styles.pppCol, styles.pppCol4]}>What’s next</Text>
        {screen === 'meeting' ? <Text style={[styles.pppCol, styles.pppCol5]}>Reviewed</Text> : null}
      </View>
    );
  }

  function renderTaskRow(x: { task: Task; cycle?: Cycle }) {
    const { task, cycle } = x;
    const isPast = cycleOffset > 0;
    const isCurrent = cycleOffset === 0;

    const canEditFields = isOwnerEditAllowed(screen) && isCurrent && task.lifecycle === 'active';
    const actualsMissing = safeTrim(cycle?.actuals || '').length === 0;
    const nextMissing = safeTrim(cycle?.nextPlan || '').length === 0;
    const showNotUpdated = screen === 'meeting' && isCurrent && task.lifecycle === 'active' && (actualsMissing || nextMissing);

    return (
      <View key={task.id} style={[styles.row, task.lifecycle !== 'active' ? styles.rowInactive : null]}>
        <View style={styles.cell1}>
          <Text style={styles.taskName}>{task.name}</Text>
          <Text style={styles.taskMeta}>{task.owner || 'Unassigned'}</Text>
          {showNotUpdated ? <Text style={styles.badgeWarn}>Not updated yet</Text> : null}
          {task.lifecycle !== 'active' ? <Text style={styles.badgeMuted}>Inactive</Text> : null}
        </View>

        <View style={styles.cell2}>
          <Text style={styles.lockedText}>{cycle?.previousPlan || ''}</Text>
        </View>

        <View style={styles.cell3}>
          {canEditFields ? (
            <TextInput
              value={cycle?.actuals || ''}
              onChangeText={(t) => updateCycleField(task.id, viewedCycleIndex, { actuals: t })}
              placeholder="Owner update…"
              style={styles.textArea}
              multiline
            />
          ) : (
            <Text style={styles.plainText}>{cycle?.actuals || ''}</Text>
          )}
        </View>

        <View style={styles.cell4}>
          {canEditFields ? (
            <TextInput
              value={cycle?.nextPlan || ''}
              onChangeText={(t) => updateCycleField(task.id, viewedCycleIndex, { nextPlan: t })}
              placeholder="Owner plan…"
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
                onPress={() =>
                  updateCycleField(task.id, viewedCycleIndex, { reviewed: !cycle?.reviewed })
                }
              >
                <Text style={styles.reviewBtnText}>{cycle?.reviewed ? 'Reviewed' : 'Mark'}</Text>
              </Pressable>
            )}
          </View>
        ) : null}
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

              <View style={{ alignItems: 'flex-end' }}>
                <Pressable style={styles.captureBtn} onPress={captureFollowUpInMeeting}>
                  <Text style={styles.captureBtnText}>＋ Capture follow-up</Text>
                </Pressable>
                <SmallMuted>Starts next period</SmallMuted>
              </View>
            </View>
          ) : null}

          <SmallMuted>
            Meeting actions: mark items reviewed, then close the period. Reorganization happens in Manage.
          </SmallMuted>
        </Card>

        <Card>
          <SectionTitle
            title="Active items"
            right={
              cycleOffset === 0 ? (
                <Pressable
                  style={[styles.primaryBtn, !canClosePeriod ? styles.primaryBtnDisabled : null]}
                  disabled={!canClosePeriod}
                  onPress={closeCurrentPeriod}
                >
                  <Text style={styles.primaryBtnText}>Close period</Text>
                </Pressable>
              ) : null
            }
          />
          {renderPPPHeader()}
          {activeRows.length === 0 ? <Text style={styles.smallMuted}>No active tasks.</Text> : null}
          {activeRows.map(renderTaskRow)}
          {cycleOffset === 0 && !allReviewedCurrent ? (
            <Text style={styles.helpText}>To close: mark all active items as reviewed.</Text>
          ) : null}
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

  function renderOwners() {
    if (!selectedWorkstream) {
      return (
        <Card>
          <Text style={styles.h1}>No workstream selected</Text>
          <SmallMuted>Choose a project and workstream above.</SmallMuted>
        </Card>
      );
    }

    const isPast = cycleOffset > 0;
    const activeRows = activeViewed;

    return (
      <>
        <Card>
          <Text style={styles.h2}>Owner expectations</Text>
          <SmallMuted>
            Owners update “What happened” + “What’s next” before the meeting. Reorganization is only available in Manage.
          </SmallMuted>
        </Card>

        <Card>
          <SectionTitle title="Add a task (owners only)" />
          <SmallMuted>Allowed here. Not allowed in Meeting. Reorg still only in Manage.</SmallMuted>

          <View style={styles.formRow}>
            <TextInput value={newTaskName} onChangeText={setNewTaskName} placeholder="Task name" style={styles.input} />
            <TextInput value={newTaskOwner} onChangeText={setNewTaskOwner} placeholder="Owner (optional)" style={styles.input} />
          </View>

          <Pressable
            style={[styles.primaryBtn, safeTrim(newTaskName).length === 0 ? styles.primaryBtnDisabled : null]}
            onPress={addTaskOwnerPrep}
            disabled={safeTrim(newTaskName).length === 0}
          >
            <Text style={styles.primaryBtnText}>Add task</Text>
          </Pressable>
        </Card>

        <Card>
          <SectionTitle title={isPast ? 'Past period (read-only)' : 'Update your items'} />
          {renderPPPHeader()}
          {activeRows.length === 0 ? <Text style={styles.smallMuted}>No active tasks.</Text> : null}
          {activeRows.map(renderTaskRow)}
          {isPast ? <Text style={styles.helpText}>Past periods are locked.</Text> : null}
        </Card>
      </>
    );
  }

  function renderManage() {
    if (!state) return null;

    const allTasksInWS = state.selectedWorkstreamId
      ? state.tasks.filter((t) => t.workstreamId === state.selectedWorkstreamId).sort((a, b) => a.name.localeCompare(b.name))
      : [];

    const active = allTasksInWS.filter((t) => t.lifecycle === 'active');
    const inactive = allTasksInWS.filter((t) => t.lifecycle !== 'active');

    return (
      <>
        <Card>
          <Text style={styles.h2}>Manage (Backstage)</Text>
          <SmallMuted>
            Reorganization happens only here: rename, owner changes, retire/reactivate, workstream creation.
          </SmallMuted>
          <View style={{ marginTop: 10 }}>
            <Pressable style={styles.dangerBtn} onPress={manageResetToSetup}>
              <Text style={styles.dangerBtnText}>Reset / run Setup Wizard</Text>
            </Pressable>
          </View>
        </Card>

        <Card>
          <SectionTitle title="Create project" />
          <View style={styles.formRow}>
            <TextInput value={manageDraftProjectName} onChangeText={setManageDraftProjectName} placeholder="Project name" style={styles.input} />
            <Pressable
              style={[styles.primaryBtn, safeTrim(manageDraftProjectName).length === 0 ? styles.primaryBtnDisabled : null]}
              onPress={manageCreateProject}
              disabled={safeTrim(manageDraftProjectName).length === 0}
            >
              <Text style={styles.primaryBtnText}>Create</Text>
            </Pressable>
          </View>
        </Card>

        <Card>
          <SectionTitle title="Create workstream" />
          <SmallMuted>Cadence is defined at the workstream level (tasks inherit).</SmallMuted>

          <View style={styles.formRow}>
            <TextInput value={manageDraftWorkstreamName} onChangeText={setManageDraftWorkstreamName} placeholder="Workstream name" style={styles.input} />
          </View>

          <View style={styles.inlineRow}>
            {(['daily', 'weekly', 'biweekly', 'monthly', 'quarterly'] as Cadence[]).map((c) => (
              <Pill key={c} label={c} active={manageDraftWorkstreamCadence === c} onPress={() => setManageDraftWorkstreamCadence(c)} />
            ))}
          </View>

          <View style={styles.formRow}>
            <TextInput
              value={manageDraftFirstCycleStart}
              onChangeText={setManageDraftFirstCycleStart}
              placeholder="First cycle start (YYYY-MM-DD)"
              style={styles.input}
              autoCapitalize="none"
            />
            <Pressable
              style={[styles.primaryBtn, safeTrim(manageDraftWorkstreamName).length === 0 ? styles.primaryBtnDisabled : null]}
              onPress={manageCreateWorkstream}
              disabled={safeTrim(manageDraftWorkstreamName).length === 0}
            >
              <Text style={styles.primaryBtnText}>Create</Text>
            </Pressable>
          </View>
        </Card>

        <Card>
          <SectionTitle title="Tasks (reorg allowed here only)" />
          {!state.selectedWorkstreamId ? <SmallMuted>Select a workstream above.</SmallMuted> : null}

          {active.length > 0 ? <Text style={styles.h3}>Active</Text> : null}
          {active.map((t) => (
            <View key={t.id} style={styles.manageTaskRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.taskName}>{t.name}</Text>
                <Text style={styles.taskMeta}>Owner: {t.owner || 'Unassigned'}</Text>
              </View>

              <Pressable
                style={styles.secondaryBtn}
                onPress={() => {
                  Alert.prompt?.('Rename task', 'New name:', [
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
                  Alert.prompt?.('Change owner', 'Owner name:', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Save', onPress: (text?: string) => manageChangeOwner(t.id, text || '') },

                  ]);
                  if (Platform.OS === 'android') Alert.alert('Owner', 'Android: owner prompt not available in this MVP.');
                }}
              >
                <Text style={styles.secondaryBtnText}>Owner</Text>
              </Pressable>

              <Pressable style={styles.dangerBtn} onPress={() => manageRetireTask(t.id)}>
                <Text style={styles.dangerBtnText}>Retire</Text>
              </Pressable>
            </View>
          ))}

          {inactive.length > 0 ? <Text style={styles.h3}>Inactive</Text> : null}
          {inactive.map((t) => (
            <View key={t.id} style={styles.manageTaskRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.taskName}>{t.name}</Text>
                <Text style={styles.taskMeta}>Owner: {t.owner || 'Unassigned'}</Text>
              </View>
              <Pressable style={styles.secondaryBtn} onPress={() => manageReactivateTask(t.id)}>
                <Text style={styles.secondaryBtnText}>Reactivate</Text>
              </Pressable>
            </View>
          ))}
        </Card>
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

  // ✅ show SetupScreen when needed
  if (needsSetup || !state) {
    return (
      <SafeAreaView style={[styles.safe, { padding: 12 }]}>
        <ScrollView>
          <SetupScreen onComplete={handleSetupComplete} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      {renderTopNav()}
      <ScrollView contentContainerStyle={styles.container}>
        {renderPeriodNavigator()}
        {screen === 'meeting' ? renderMeeting() : null}
        {screen === 'owners' ? renderOwners() : null}
        {screen === 'manage' ? renderManage() : null}
        <View style={{ height: 36 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ------------------------------
// Styles (same visual language as Dec21)
// ------------------------------

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0b0c' },
  container: { padding: 12, gap: 12 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  appTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },

  topNav: { padding: 12, paddingTop: 10, backgroundColor: '#0b0b0c', borderBottomWidth: 1, borderBottomColor: '#1f1f22' },
  topNavRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  topNavPills: { flexDirection: 'row', gap: 8 },

  scopeRow: { marginTop: 10, gap: 10 },
  scopeBlock: { gap: 6 },
  inlineRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },

  pill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  pillActive: { backgroundColor: '#ffffff' },
  pillInactive: { backgroundColor: '#151518' },
  pillText: { fontSize: 13, fontWeight: '600' },
  pillTextActive: { color: '#0b0b0c' },
  pillTextInactive: { color: '#e6e6e6' },

  card: { backgroundColor: '#111114', borderRadius: 16, padding: 12, borderWidth: 1, borderColor: '#222228' },

  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 8 },
  sectionTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },

  h1: { color: '#fff', fontSize: 18, fontWeight: '800' },
  h2: { color: '#fff', fontSize: 16, fontWeight: '800' },
  h3: { color: '#fff', fontSize: 14, fontWeight: '800', marginTop: 6, marginBottom: 6 },

  smallMuted: { color: '#a6a6ad', fontSize: 12, lineHeight: 16 },
  helpText: { color: '#a6a6ad', fontSize: 12, marginTop: 8 },

  periodNav: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  navBtn: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#151518', borderWidth: 1, borderColor: '#2a2a31' },
  navBtnDisabled: { opacity: 0.4 },
  navBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  periodCenter: { flex: 1, alignItems: 'center', gap: 2 },
  periodTitle: { color: '#fff', fontSize: 16, fontWeight: '800' },
  periodSub: { color: '#d4d4d8', fontSize: 13, fontWeight: '600' },
  periodHint: { color: '#a6a6ad', fontSize: 12 },

  readinessRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 8 },
  readinessText: { color: '#e9e9ee', fontSize: 13, marginTop: 4 },
  readinessWarn: { color: '#ffd08a', fontSize: 13, marginTop: 2, fontWeight: '700' },
  readinessOk: { color: '#b8f7c7', fontSize: 13, marginTop: 2, fontWeight: '700' },
  bold: { fontWeight: '900' },

  captureBtn: { backgroundColor: '#151518', borderWidth: 1, borderColor: '#2a2a31', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8 },
  captureBtnText: { color: '#fff', fontWeight: '800' },

  pppHeader: { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#23232a' },
  pppCol: { color: '#a6a6ad', fontSize: 12, fontWeight: '800' },
  pppCol1: { flex: 1.0, paddingRight: 8 },
  pppCol2: { flex: 1.4, paddingRight: 8 },
  pppCol3: { flex: 1.4, paddingRight: 8 },
  pppCol4: { flex: 1.4, paddingRight: 8 },
  pppCol5: { width: 92, textAlign: 'center' },

  row: { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1f1f22' },
  rowInactive: { opacity: 0.55 },

  cell1: { flex: 1.0, paddingRight: 8, gap: 4 },
  cell2: { flex: 1.4, paddingRight: 8 },
  cell3: { flex: 1.4, paddingRight: 8 },
  cell4: { flex: 1.4, paddingRight: 8 },
  cell5: { width: 92, alignItems: 'center', justifyContent: 'center' },

  taskName: { color: '#fff', fontSize: 13, fontWeight: '800' },
  taskMeta: { color: '#a6a6ad', fontSize: 12, fontWeight: '600' },

  badgeWarn: { alignSelf: 'flex-start', backgroundColor: '#2a2318', borderWidth: 1, borderColor: '#5b431f', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, color: '#ffd08a', fontSize: 11, fontWeight: '800' },
  badgeMuted: { alignSelf: 'flex-start', backgroundColor: '#151518', borderWidth: 1, borderColor: '#2a2a31', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, color: '#bdbdc6', fontSize: 11, fontWeight: '800' },

  lockedText: { color: '#d4d4d8', fontSize: 12, lineHeight: 16 },
  plainText: { color: '#ffffff', fontSize: 12, lineHeight: 16 },

  textArea: {
    minHeight: 48,
    maxHeight: 160,
    padding: 8,
    borderRadius: 12,
    backgroundColor: '#0e0e10',
    borderWidth: 1,
    borderColor: '#26262d',
    color: '#fff',
    fontSize: 12,
    lineHeight: 16,
  },

  input: {
    flex: 1,
    padding: 10,
    borderRadius: 12,
    backgroundColor: '#0e0e10',
    borderWidth: 1,
    borderColor: '#26262d',
    color: '#fff',
  },

  formRow: { flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: 8, marginBottom: 8 },

  primaryBtn: { backgroundColor: '#ffffff', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryBtnText: { color: '#0b0b0c', fontWeight: '900' },

  secondaryBtn: { backgroundColor: '#151518', borderWidth: 1, borderColor: '#2a2a31', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12, marginLeft: 8 },
  secondaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 12 },

  dangerBtn: { backgroundColor: '#2a1416', borderWidth: 1, borderColor: '#5b1f25', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12, marginTop: 8 },
  dangerBtnText: { color: '#ffb4bd', fontWeight: '900', fontSize: 12 },

  reviewBtn: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12, borderWidth: 1, width: 84, alignItems: 'center' },
  reviewBtnOn: { backgroundColor: '#122016', borderColor: '#255b31' },
  reviewBtnOff: { backgroundColor: '#151518', borderColor: '#2a2a31' },
  reviewBtnText: { color: '#fff', fontWeight: '900', fontSize: 12 },
  mutedCenter: { color: '#a6a6ad', fontWeight: '800' },

  manageTaskRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1f1f22' },
});
