import { describe, it, expect } from 'vitest';
import { createYnabExtension } from '../../src/index.js';
import { createMockExtensionAPI, createMockYnabAPI, getTools } from '../test-helpers.js';

function makeMonth() {
  return {
    month: '2026-05-01',
    income: 1000000,
    budgeted: 800000,
    activity: -250000,
    to_be_budgeted: 200000,
    deleted: false,
    categories: [
      {
        id: 'cat-food',
        category_group_id: 'group-1',
        category_group_name: 'Everyday',
        name: 'Food',
        hidden: false,
        budgeted: 500000,
        activity: -450000,
        balance: 50000,
        deleted: false,
        goal_type: 'NEED',
        goal_target: 600000,
        goal_under_funded: 100000,
        goal_overall_left: 100000
      },
      {
        id: 'cat-dining',
        category_group_id: 'group-1',
        category_group_name: 'Everyday',
        name: 'Dining Out',
        hidden: false,
        budgeted: 100000,
        activity: -125000,
        balance: -25000,
        deleted: false
      }
    ]
  };
}

describe('YNAB budgeting tools', () => {
  function setup() {
    const ynabAPI = createMockYnabAPI();
    const extApi = createMockExtensionAPI();
    createYnabExtension({ ynabAPI, defaultBudgetId: 'budget-123' })(extApi);
    return { ynabAPI, tools: getTools(extApi) };
  }

  it('gets budget month with ready to assign in USD', async () => {
    const { ynabAPI, tools } = setup();
    ynabAPI.months.getPlanMonth.mockResolvedValue({ data: { month: makeMonth() } });

    const tool = tools.find(t => t.name === 'ynab_get_budget_month')!;
    const result = await tool.execute('call-1', { month: '2026-05-01' });

    expect(ynabAPI.months.getPlanMonth).toHaveBeenCalledWith('budget-123', '2026-05-01');
    expect(result.content[0].text).toContain('Ready to Assign: $200.00 USD');
    expect(result.content[0].text).toContain('Overspent categories: 1');
  });

  it('lists categories with amounts and goals', async () => {
    const { ynabAPI, tools } = setup();
    ynabAPI.months.getPlanMonth.mockResolvedValue({ data: { month: makeMonth() } });

    const tool = tools.find(t => t.name === 'ynab_get_categories')!;
    const result = await tool.execute('call-1', { query: 'food', includeGoals: true });

    expect(result.content[0].text).toContain('Food');
    expect(result.content[0].text).toContain('Assigned: $500.00 USD');
    expect(result.content[0].text).toContain('Goal: NEED');
    expect(result.content[0].text).not.toContain('Dining Out');
  });

  it('assigns money using currency.js dollars and returns validation details', async () => {
    const { ynabAPI, tools } = setup();
    const updatedMonth = makeMonth();
    updatedMonth.to_be_budgeted = 174500;
    updatedMonth.categories[0] = {
      ...updatedMonth.categories[0],
      budgeted: 525500,
      balance: 75500,
      goal_under_funded: 74500
    };
    ynabAPI.months.getPlanMonth
      .mockResolvedValueOnce({ data: { month: makeMonth() } })
      .mockResolvedValueOnce({ data: { month: updatedMonth } });
    ynabAPI.categories.updateMonthCategory.mockResolvedValue({ data: {} });

    const tool = tools.find(t => t.name === 'ynab_assign_money')!;
    const result = await tool.execute('call-1', { month: '2026-05-01', category: 'Food', deltaAmount: 25.5 });

    expect(ynabAPI.categories.updateMonthCategory).toHaveBeenCalledWith('budget-123', '2026-05-01', 'cat-food', {
      category: { budgeted: 525500 }
    });
    expect(ynabAPI.months.getPlanMonth).toHaveBeenCalledTimes(2);
    expect(result.content[0].text).toContain('Delta: $25.50 USD');
    expect(result.content[0].text).toContain('Available: $50.00 USD -> $75.50 USD');
    expect(result.content[0].text).toContain('Underfunded: $100.00 USD -> $74.50 USD');
    expect(result.content[0].text).toContain('Ready to Assign: $200.00 USD -> $174.50 USD');
    expect(result.content[0].text).toContain('Overspent categories: 1 -> 1');
  });

  it('includes credit card account balance and payment coverage when assigning card payments', async () => {
    const { ynabAPI, tools } = setup();
    const beforeMonth = makeMonth();
    beforeMonth.categories.push({
      id: 'cat-visa',
      category_group_id: 'group-cc',
      category_group_name: 'Credit Card Payments',
      name: 'Visa',
      hidden: false,
      budgeted: 0,
      activity: 21934,
      balance: 21934,
      deleted: false
    });
    const afterMonth = makeMonth();
    afterMonth.to_be_budgeted = 5000;
    afterMonth.categories.push({
      id: 'cat-visa',
      category_group_id: 'group-cc',
      category_group_name: 'Credit Card Payments',
      name: 'Visa',
      hidden: false,
      budgeted: 195000,
      activity: 21934,
      balance: 216934,
      deleted: false
    });
    ynabAPI.months.getPlanMonth
      .mockResolvedValueOnce({ data: { month: beforeMonth } })
      .mockResolvedValueOnce({ data: { month: afterMonth } });
    ynabAPI.categories.updateMonthCategory.mockResolvedValue({ data: {} });
    ynabAPI.accounts.getAccounts.mockResolvedValue({
      data: {
        accounts: [
          {
            id: 'acc-visa',
            name: 'Visa',
            type: 'creditCard',
            on_budget: true,
            closed: false,
            balance: -216934,
            cleared_balance: -216934,
            uncleared_balance: 0,
            transfer_payee_id: 'payee-visa',
            deleted: false
          }
        ]
      }
    });

    const tool = tools.find(t => t.name === 'ynab_assign_money')!;
    const result = await tool.execute('call-1', { month: '2026-05-01', category: 'Visa', assignedAmount: 195 });

    expect(result.content[0].text).toContain('Credit card: Visa balance -$216.93 USD | Payment available $216.93 USD | Difference $0.00 USD');
  });

  it('moves money between categories', async () => {
    const { ynabAPI, tools } = setup();
    ynabAPI.months.getPlanMonth.mockResolvedValue({ data: { month: makeMonth() } });
    ynabAPI.categories.updateMonthCategory.mockResolvedValue({ data: {} });

    const tool = tools.find(t => t.name === 'ynab_move_money')!;
    const result = await tool.execute('call-1', {
      month: '2026-05-01',
      fromCategory: 'Food',
      toCategory: 'Dining Out',
      amount: 10
    });

    expect(ynabAPI.categories.updateMonthCategory).toHaveBeenNthCalledWith(1, 'budget-123', '2026-05-01', 'cat-food', {
      category: { budgeted: 490000 }
    });
    expect(ynabAPI.categories.updateMonthCategory).toHaveBeenNthCalledWith(2, 'budget-123', '2026-05-01', 'cat-dining', {
      category: { budgeted: 110000 }
    });
    expect(result.content[0].text).toContain('$10.00 USD from Food to Dining Out');
  });

  it('updates supported category goal fields', async () => {
    const { ynabAPI, tools } = setup();
    ynabAPI.categories.getCategories.mockResolvedValue({
      data: {
        category_groups: [
          { id: 'group-1', name: 'Everyday', categories: makeMonth().categories }
        ]
      }
    });
    ynabAPI.categories.updateCategory.mockResolvedValue({ data: {} });

    const tool = tools.find(t => t.name === 'ynab_update_category_goal')!;
    const result = await tool.execute('call-1', {
      category: 'Food',
      targetAmount: 650,
      targetDate: '2026-06-01',
      needsWholeAmount: true
    });

    expect(ynabAPI.categories.updateCategory).toHaveBeenCalledWith('budget-123', 'cat-food', {
      category: {
        goal_target: 650000,
        goal_target_date: '2026-06-01',
        goal_needs_whole_amount: true
      }
    });
    expect(result.content[0].text).toContain('Target amount: $650.00 USD');
  });
});
