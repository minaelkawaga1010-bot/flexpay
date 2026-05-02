import apiClient from './client';

export interface SavingsGoal {
  id: string;
  name: string;
  targetAmount: number;
  savedAmount: number;
  monthlyAuto: number | null;
  deadline: string | null;
  status: 'ACTIVE' | 'COMPLETED' | 'PAUSED' | 'CANCELLED';
  progress: number;
}

export const savingsService = {
  async listGoals(): Promise<{ goals: SavingsGoal[] }> {
    const { data } = await apiClient.get<{ goals: SavingsGoal[] }>('/savings/goals');
    return data;
  },

  async createGoal(payload: {
    name: string;
    targetAmount: number;
    monthlyAuto?: number;
    deadline?: string;
  }): Promise<{ goal: SavingsGoal }> {
    const { data } = await apiClient.post<{ goal: SavingsGoal }>('/savings/goals', payload);
    return data;
  },

  async deposit(goalId: string, amount: number): Promise<{ goal: SavingsGoal }> {
    const { data } = await apiClient.post<{ goal: SavingsGoal }>(
      `/savings/goals/${goalId}/deposit`,
      { amount },
    );
    return data;
  },

  async withdraw(goalId: string, amount: number): Promise<{ goal: SavingsGoal }> {
    const { data } = await apiClient.post<{ goal: SavingsGoal }>(
      `/savings/goals/${goalId}/withdraw`,
      { amount },
    );
    return data;
  },
};
