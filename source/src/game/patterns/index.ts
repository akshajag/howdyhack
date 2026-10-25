import type { Pattern } from '../types';
import { beachPatterns } from './beach';
import { pierPatterns } from './pier';
import { coralPatterns } from './coral';
import { grottoPatterns } from './grotto';
import { transitionPatterns, surgePatterns } from './transitions';
import { surfPatterns, surfTransitions, surfSurge } from './surf';
import { skiPatterns, skiTransitions, skiSurge } from './ski';

export const PATTERNS: Pattern[] = [...beachPatterns, ...pierPatterns, ...coralPatterns, ...grottoPatterns, ...transitionPatterns, ...surgePatterns, ...surfPatterns, ...surfTransitions, ...surfSurge, ...skiPatterns, ...skiTransitions, ...skiSurge];
export const byId = new Map(PATTERNS.map((p) => [p.id, p]));
