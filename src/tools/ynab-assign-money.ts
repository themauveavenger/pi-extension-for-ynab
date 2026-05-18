import type * as ynab from 'ynab';
import type currency from 'currency.js';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { formatAssignMoneyResponse, type AssignMoneyValidationDetails } from '../formatters.js';
import { currencyToMilliunits, getCurrentBudgetMonth, getYnabErrorMessage, isYnabNotFoundError, milliunitsToCurrency, ynabCurrency } from '../utils.js';

const paramsSchema = Type.Object({
  budgetId: Type.Optional(Type.String({ description: 'The UUID of the YNAB budget. Defaults from extension config or YNAB_BUDGET_ID.' })),
  month: Type.Optional(Type.String({ description: 'Budget month (YYYY-MM-01). Defaults to current month.' })),
  category: Type.String({ description: 'Exact category name as it appears in YNAB.' }),
  assignedAmount: Type.Optional(Type.Number({ description: 'Set assigned amount to this USD amount. Mutually exclusive with deltaAmount.' })),
  deltaAmount: Type.Optional(Type.Number({ description: 'Increase/decrease assigned by this USD amount. Mutually exclusive with assignedAmount.' })),
  dryRun: Type.Optional(Type.Boolean({ description: 'If true, show the change without updating YNAB. Defaults to false.' }))
});

function findCategory(categories: ynab.Category[], name: string): ynab.Category | null {
  return categories.find(c => !c.deleted && !c.hidden && c.name === name) ?? null;
}

function visibleCategories(month: ynab.MonthDetail): ynab.Category[] {
  return month.categories.filter(c => !c.deleted && !c.hidden);
}

function getVisibleCategoryCounts(month: ynab.MonthDetail): { overspentCategoryCount: number; availableCategoryCount: number } {
  const categories = visibleCategories(month);
  return {
    overspentCategoryCount: categories.filter(c => c.balance < 0).length,
    availableCategoryCount: categories.filter(c => c.balance > 0).length
  };
}

function maybeCurrency(milliunits: number | null | undefined): currency | undefined {
  return milliunits === null || milliunits === undefined ? undefined : milliunitsToCurrency(milliunits);
}

function isCreditCardPaymentCategory(category: ynab.Category): boolean {
  return category.category_group_name === 'Credit Card Payments';
}

async function getCreditCardAssignmentDetails(
  ynabAPI: ynab.API,
  budgetId: string,
  category: ynab.Category
): Promise<AssignMoneyValidationDetails['creditCard']> {
  if (!isCreditCardPaymentCategory(category)) return undefined;

  const response = await ynabAPI.accounts.getAccounts(budgetId);
  const account = response.data.accounts.find(a => !a.deleted && !a.closed && a.on_budget && a.type === 'creditCard' && a.name === category.name);
  if (!account) return undefined;

  const accountBalance = milliunitsToCurrency(account.balance);
  const paymentAvailable = milliunitsToCurrency(category.balance);
  const amountNeededToPayBalance = milliunitsToCurrency(Math.abs(account.balance));

  return {
    accountName: account.name,
    accountBalance,
    paymentAvailable,
    paymentDifference: paymentAvailable.subtract(amountNeededToPayBalance)
  };
}

export default function createTool(
  ynabAPI: ynab.API,
  resolveBudgetId: (budgetId?: string) => string
): ToolDefinition<typeof paramsSchema> {
  return {
    name: 'ynab_assign_money',
    label: 'Assign YNAB Money',
    description: 'Sets or adjusts the assigned amount for a YNAB category in a budget month.',
    promptSnippet: 'Set or adjust the assigned amount for one YNAB category in a budget month.',
    promptGuidelines: [
      'Use ynab_assign_money when the user wants to set a category assigned amount or add/subtract from assigned funds.',
      'Use ynab_assign_money with dryRun=true before applying changes unless the user explicitly asks to update YNAB now.',
      'Use exactly one of assignedAmount or deltaAmount with ynab_assign_money.',
      'Use ynab_get_categories before ynab_assign_money when the exact visible category name is uncertain.'
    ],
    parameters: paramsSchema,
    async execute(_toolCallId, params) {
      if ((params.assignedAmount === undefined && params.deltaAmount === undefined)
        || (params.assignedAmount !== undefined && params.deltaAmount !== undefined)) {
        return { content: [{ type: 'text' as const, text: 'Error: Provide exactly one of assignedAmount or deltaAmount.' }], details: {} };
      }

      let budgetId: string;
      try {
        budgetId = resolveBudgetId(params.budgetId);
      }
      catch (error) {
        return { content: [{ type: 'text' as const, text: `Error: ${String(error instanceof Error ? error.message : error)}` }], details: {} };
      }

      try {
        const month = params.month ?? getCurrentBudgetMonth();
        const monthResponse = await ynabAPI.months.getPlanMonth(budgetId, month);
        const category = findCategory(monthResponse.data.month.categories, params.category);
        if (!category) {
          return { content: [{ type: 'text' as const, text: `Error: Category "${params.category}" not found. Verify the exact visible category name as it appears in YNAB.` }], details: {} };
        }

        const previousAssigned = milliunitsToCurrency(category.budgeted);
        const newAssigned = params.assignedAmount !== undefined
          ? ynabCurrency(params.assignedAmount)
          : previousAssigned.add(ynabCurrency(params.deltaAmount ?? 0));
        const delta = newAssigned.subtract(previousAssigned);
        const dryRun = params.dryRun ?? false;

        let validation: AssignMoneyValidationDetails | undefined;
        const previousReadyToAssign = milliunitsToCurrency(monthResponse.data.month.to_be_budgeted);
        const previousCategoryCounts = getVisibleCategoryCounts(monthResponse.data.month);
        const deltaMilliunits = currencyToMilliunits(delta);

        if (dryRun) {
          const newCategory = {
            ...category,
            budgeted: currencyToMilliunits(newAssigned),
            balance: category.balance + deltaMilliunits,
            goal_under_funded: category.goal_under_funded === null || category.goal_under_funded === undefined
              ? category.goal_under_funded
              : Math.max(category.goal_under_funded - deltaMilliunits, 0)
          };
          const simulatedMonth = {
            ...monthResponse.data.month,
            to_be_budgeted: monthResponse.data.month.to_be_budgeted - deltaMilliunits,
            categories: monthResponse.data.month.categories.map(c => c.id === category.id ? newCategory : c)
          };
          validation = {
            previousAvailable: milliunitsToCurrency(category.balance),
            newAvailable: milliunitsToCurrency(newCategory.balance),
            previousUnderfunded: maybeCurrency(category.goal_under_funded),
            newUnderfunded: maybeCurrency(newCategory.goal_under_funded),
            previousReadyToAssign,
            newReadyToAssign: milliunitsToCurrency(simulatedMonth.to_be_budgeted),
            previousOverspentCategoryCount: previousCategoryCounts.overspentCategoryCount,
            newOverspentCategoryCount: getVisibleCategoryCounts(simulatedMonth).overspentCategoryCount,
            previousAvailableCategoryCount: previousCategoryCounts.availableCategoryCount,
            newAvailableCategoryCount: getVisibleCategoryCounts(simulatedMonth).availableCategoryCount,
            creditCard: await getCreditCardAssignmentDetails(ynabAPI, budgetId, newCategory)
          };
        }
        else {
          const updateResponse = await ynabAPI.categories.updateMonthCategory(budgetId, month, category.id, {
            category: { budgeted: currencyToMilliunits(newAssigned) }
          });
          const updatedMonthResponse = await ynabAPI.months.getPlanMonth(budgetId, month);
          const updatedCategory = findCategory(updatedMonthResponse.data.month.categories, category.name) ?? updateResponse.data.category;
          validation = {
            previousAvailable: milliunitsToCurrency(category.balance),
            newAvailable: milliunitsToCurrency(updatedCategory.balance),
            previousUnderfunded: maybeCurrency(category.goal_under_funded),
            newUnderfunded: maybeCurrency(updatedCategory.goal_under_funded),
            previousReadyToAssign,
            newReadyToAssign: milliunitsToCurrency(updatedMonthResponse.data.month.to_be_budgeted),
            previousOverspentCategoryCount: previousCategoryCounts.overspentCategoryCount,
            newOverspentCategoryCount: getVisibleCategoryCounts(updatedMonthResponse.data.month).overspentCategoryCount,
            previousAvailableCategoryCount: previousCategoryCounts.availableCategoryCount,
            newAvailableCategoryCount: getVisibleCategoryCounts(updatedMonthResponse.data.month).availableCategoryCount,
            creditCard: await getCreditCardAssignmentDetails(ynabAPI, budgetId, updatedCategory)
          };
        }

        return {
          content: [{ type: 'text' as const, text: formatAssignMoneyResponse(category.name, month, previousAssigned, newAssigned, delta, dryRun, validation) }],
          details: {}
        };
      }
      catch (error) {
        const message = isYnabNotFoundError(error)
          ? `Budget "${budgetId}" or month "${params.month ?? getCurrentBudgetMonth()}" not found.`
          : getYnabErrorMessage(error);
        return { content: [{ type: 'text' as const, text: `Error: Failed to assign money in YNAB.\n${message}` }], details: {} };
      }
    }
  };
}
