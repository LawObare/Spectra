import { create } from 'zustand';
import {
  WALKTHROUGH_STEPS,
  type ExploreTabId,
  type WalkthroughChapterId,
  type WalkthroughStep,
} from '../config/walkthroughSteps';

export const WALKTHROUGH_STORAGE_KEY = 'spx_walkthrough_v1';

type WalkthroughStatus = 'unseen' | 'in_progress' | 'completed' | 'dismissed';

interface PersistedWalkthroughState {
  version: 1;
  status: WalkthroughStatus;
  lastStepId?: string;
  updatedAt: string;
}

function readPersistedState(): PersistedWalkthroughState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(WALKTHROUGH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedWalkthroughState>;
    if (parsed && parsed.version === 1 && typeof parsed.status === 'string') {
      return {
        version: 1,
        status: parsed.status as WalkthroughStatus,
        lastStepId: parsed.lastStepId,
        updatedAt: parsed.updatedAt || new Date().toISOString(),
      };
    }
  } catch {
    // Ignore corrupt localStorage entries
  }
  return null;
}

function writePersistedState(status: WalkthroughStatus, lastStepId?: string): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: PersistedWalkthroughState = {
      version: 1,
      status,
      lastStepId,
      updatedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(WALKTHROUGH_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage quota / private-mode errors
  }
}

export interface WalkthroughState {
  isOpen: boolean;
  mode: 'full' | 'chapter';
  steps: WalkthroughStep[];
  stepIndex: number;
  hasSeenOnce: boolean;

  maybeAutoStartExplore: (isEmbed: boolean) => void;
  startFullTour: (startStepId?: string) => void;
  startChapterTour: (chapterId: WalkthroughChapterId | ExploreTabId) => void;
  nextStep: () => void;
  prevStep: () => void;
  skipToNextChapter: () => void;
  jumpToChapter: (chapterId: WalkthroughChapterId) => void;
  dismissTour: () => void;
  completeTour: () => void;
}

export const useWalkthroughStore = create<WalkthroughState>((set, get) => ({
  isOpen: false,
  mode: 'full',
  steps: WALKTHROUGH_STEPS,
  stepIndex: 0,
  hasSeenOnce: Boolean(readPersistedState()),

  maybeAutoStartExplore: (isEmbed) => {
    if (isEmbed) return;
    const persisted = readPersistedState();
    if (persisted && (persisted.status === 'completed' || persisted.status === 'dismissed')) {
      set({ hasSeenOnce: true });
      return;
    }
    const { isOpen } = get();
    if (isOpen) return;
    writePersistedState('in_progress', WALKTHROUGH_STEPS[0]?.id);
    set({
      isOpen: true,
      mode: 'full',
      steps: WALKTHROUGH_STEPS,
      stepIndex: 0,
      hasSeenOnce: true,
    });
  },

  startFullTour: (startStepId) => {
    const idx = startStepId
      ? Math.max(0, WALKTHROUGH_STEPS.findIndex((s) => s.id === startStepId))
      : 0;
    const step = WALKTHROUGH_STEPS[idx] ?? WALKTHROUGH_STEPS[0];
    writePersistedState('in_progress', step?.id);
    set({
      isOpen: true,
      mode: 'full',
      steps: WALKTHROUGH_STEPS,
      stepIndex: idx,
      hasSeenOnce: true,
    });
  },

  startChapterTour: (chapterOrTab) => {
    const normalizedChapter: WalkthroughChapterId =
      chapterOrTab === 'discussions' ? 'forum' : chapterOrTab;
    const filtered = WALKTHROUGH_STEPS.filter((s) => s.chapterId === normalizedChapter);
    if (filtered.length === 0) return;
    writePersistedState('in_progress', filtered[0].id);
    set({
      isOpen: true,
      mode: 'chapter',
      steps: filtered,
      stepIndex: 0,
      hasSeenOnce: true,
    });
  },

  nextStep: () => {
    const { steps, stepIndex, completeTour } = get();
    if (stepIndex >= steps.length - 1) {
      completeTour();
      return;
    }
    const nextIdx = stepIndex + 1;
    writePersistedState('in_progress', steps[nextIdx]?.id);
    set({ stepIndex: nextIdx });
  },

  prevStep: () => {
    const { steps, stepIndex } = get();
    if (stepIndex <= 0) return;
    const prevIdx = stepIndex - 1;
    writePersistedState('in_progress', steps[prevIdx]?.id);
    set({ stepIndex: prevIdx });
  },

  skipToNextChapter: () => {
    const { steps, stepIndex, completeTour } = get();
    const current = steps[stepIndex];
    if (!current) {
      completeTour();
      return;
    }
    const nextChapterIdx = steps.findIndex(
      (s, i) => i > stepIndex && s.chapterId !== current.chapterId
    );
    if (nextChapterIdx === -1) {
      completeTour();
      return;
    }
    writePersistedState('in_progress', steps[nextChapterIdx]?.id);
    set({ stepIndex: nextChapterIdx });
  },

  jumpToChapter: (chapterId) => {
    const { steps } = get();
    const idx = steps.findIndex((s) => s.chapterId === chapterId);
    if (idx >= 0) {
      writePersistedState('in_progress', steps[idx].id);
      set({ stepIndex: idx });
      return;
    }
    const fullIdx = WALKTHROUGH_STEPS.findIndex((s) => s.chapterId === chapterId);
    if (fullIdx >= 0) {
      writePersistedState('in_progress', WALKTHROUGH_STEPS[fullIdx].id);
      set({
        isOpen: true,
        mode: 'full',
        steps: WALKTHROUGH_STEPS,
        stepIndex: fullIdx,
        hasSeenOnce: true,
      });
    }
  },

  dismissTour: () => {
    const { steps, stepIndex } = get();
    writePersistedState('dismissed', steps[stepIndex]?.id);
    set({ isOpen: false, hasSeenOnce: true });
  },

  completeTour: () => {
    const { steps, stepIndex } = get();
    writePersistedState('completed', steps[stepIndex]?.id);
    set({ isOpen: false, hasSeenOnce: true });
  },
}));
