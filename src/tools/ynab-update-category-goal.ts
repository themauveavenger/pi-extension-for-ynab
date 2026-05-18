import type * as ynab from 'ynab';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { formatUpdateCategoryGoalResponse } from '../formatters.js';
import { currencyToMilliunits, formatUsd, getYnabErrorMessage, isYnabNotFoundError, ynabCurrency } from '../utils.js';

const paramsSchema = Type.Object({
  budgetId: Type.Optional(Type.String({ description: 'The UUID of the YNAB budget. Defaults from extension config or YNAB_BUDGET_ID.' })),
  category: Type.String({ description: 'Exact category name as it appears in YNAB.' }),
  targetAmount: Type.Optional(Type.Number({ description: 'Goal target amount in USD.' })),
  targetDate: Type.Optional(Type.String({ description: 'Goal target date in ISO format, e.g. YYYY-MM-DD or YYYY-MM-01.' })),
  needsWholeAmount: Type.Optional(Type.Boolean({ description: 'For NEED goals: true for Set Aside, false for Refill.' })),
  clearTargetAmount: Type.Optional(Type.Boolean({ description: 'Clear goal target amount.' })),
  clearTargetDate: Type.Optional(Type.Boolean({ description: 'Clear goal target date.' })),
  dryRun: Type.Optional(Type.Boolean({ description: 'If true, show changes without updating YNAB. Defaults to false.' }))
});

interface GoalUpdateCategoryPayload {
  goal_target?: number | null;
  goal_target_date?: string | null;
  goal_needs_whole_amount?: boolean;
}

function findCategory(groups: ynab.CategoryGroupWithCategories[], name: string): ynab.Category | null {
  for (const group of groups) {
    const match = group.categories.find(c => !c.deleted && !c.hidden && c.name === name);
    if (match) return match;
  }
  return null;
}

export default function createTool(
  ynabAPI: ynab.API,
  resolveBudgetId: (budgetId?: string) => string
): ToolDefinition<typeof paramsSchema> {
  return {
    name: 'ynab_update_category_goal',
    label: 'Update YNAB Category Goal',
    description: 'Updates supported YNAB category goal fields: target amount, target date, and NEED goal whole-amount behavior. Goal type, cadence, and snooze are not supported by the SDK.',
    promptSnippet: 'Update supported YNAB category goal fields: target amount, target date, or NEED whole-amount behavior.',
    promptGuidelines: [
      'Use ynab_update_category_goal only for supported goal fields: target amount, target date, and NEED goal whole-amount behavior.',
      'Use ynab_update_category_goal with dryRun=true before applying goal changes unless the user explicitly asks to update YNAB now.',
      'Use ynab_get_categories with includeGoals=true before ynab_update_category_goal when current goal details or exact category names are uncertain.',
      'Do not use ynab_update_category_goal for unsupported goal changes such as goal type, cadence, or snooze.'
    ],
    parameters: paramsSchema,
    async execute(_toolCallId, params) {
      if (params.targetAmount !== undefined && params.clearTargetAmount) {
        return { content: [{ type: 'text' as const, text: 'Error: Provide either targetAmount or clearTargetAmount, not both.' }], details: {} };
      }
      if (params.targetDate !== undefined && params.clearTargetDate) {
        return { content: [{ type: 'text' as const, text: 'Error: Provide either targetDate or clearTargetDate, not both.' }], details: {} };
      }
      if (params.targetAmount === undefined && !params.clearTargetAmount && params.targetDate === undefined && !params.clearTargetDate && params.needsWholeAmount === undefined) {
        return { content: [{ type: 'text' as const, text: 'Error: Provide at least one goal change.' }], details: {} };
      }

      let budgetId: string;
      try {
        budgetId = resolveBudgetId(params.budgetId);
      }
      catch (error) {
        return { content: [{ type: 'text' as const, text: `Error: ${String(error instanceof Error ? error.message : error)}` }], details: {} };
      }

      try {
        const categoriesResponse = await ynabAPI.categories.getCategories(budgetId);
        const category = findCategory(categoriesResponse.data.category_groups, params.category);
        if (!category) {
          return { content: [{ type: 'text' as const, text: `Error: Category "${params.category}" not found. Verify the exact visible category name as it appears in YNAB.` }], details: {} };
        }

        const categoryUpdate: GoalUpdateCategoryPayload = {};
        const changes: string[] = [];

        if (params.clearTargetAmount) {
          categoryUpdate.goal_target = null;
          changes.push('Target amount: cleared');
        }
        else if (params.targetAmount !== undefined) {
          const targetAmount = ynabCurrency(params.targetAmount);
          categoryUpdate.goal_target = currencyToMilliunits(targetAmount);
          changes.push(`Target amount: ${formatUsd(targetAmount)}`);
        }

        if (params.clearTargetDate) {
          categoryUpdate.goal_target_date = null;
          changes.push('Target date: cleared');
        }
        else if (params.targetDate !== undefined) {
          categoryUpdate.goal_target_date = params.targetDate;
          changes.push(`Target date: ${params.targetDate}`);
        }

        if (params.needsWholeAmount !== undefined) {
          categoryUpdate.goal_needs_whole_amount = params.needsWholeAmount;
          changes.push(`Needs whole amount: ${params.needsWholeAmount}`);
        }

        const dryRun = params.dryRun ?? false;
        if (!dryRun) {
          await ynabAPI.categories.updateCategory(
            budgetId,
            category.id,
            { category: categoryUpdate } as unknown as ynab.PatchCategoryWrapper
          );
        }

        return {
          content: [{ type: 'text' as const, text: formatUpdateCategoryGoalResponse(category.name, dryRun, changes) }],
          details: {}
        };
      }
      catch (error) {
        const message = isYnabNotFoundError(error)
          ? `Budget "${budgetId}" not found. Verify the budget ID.`
          : getYnabErrorMessage(error);
        return { content: [{ type: 'text' as const, text: `Error: Failed to update YNAB category goal.\n${message}` }], details: {} };
      }
    }
  };
}
