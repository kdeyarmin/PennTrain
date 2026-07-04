export type CareMetricPayload = {
  role: string;
  summary: {
    coursesPublished: number;
    coursesTotal: number;
    assignments: number;
    completed: number;
    overdue: number;
    pendingExternalReviews: number;
    expiringMedicationCertifications: number;
    incompleteCompetencies: number;
    compliancePercentage: number;
  };
  auditEvents: Array<{ action: string; entityType: string; entityId: string; createdAt: string }>;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function fetchCareMetricPayload() {
  return request<CareMetricPayload>('/caremetric');
}

export function createCareMetricCourse(input: { title: string; category: string; hours: number }) {
  return request('/caremetric/courses', { method: 'POST', body: JSON.stringify(input) });
}

export function assignCareMetricCourse(input: { staff: string; courseId: string; dueDate: string }) {
  return request('/caremetric/assignments', { method: 'POST', body: JSON.stringify(input) });
}

export function submitCareMetricQuiz(input: { assignmentId: string; answers: boolean[]; passingScore: number }) {
  return request('/caremetric/quiz-attempts', { method: 'POST', body: JSON.stringify(input) });
}

export function reviewCareMetricExternalRecord(id: string, input: { status: 'approved' | 'rejected'; reviewComments?: string }) {
  return request(`/caremetric/external-records/${id}/review`, { method: 'POST', body: JSON.stringify(input) });
}

export function completeCareMetricCompetency(id: string, input: { observedBy: string; status: 'passed' | 'failed'; comments?: string }) {
  return request(`/caremetric/competencies/${id}/complete`, { method: 'POST', body: JSON.stringify(input) });
}

export function markCareMetricInserviceAttendance(id: string, input: { staff: string; attended: boolean }) {
  return request(`/caremetric/inservices/${id}/attendance`, { method: 'POST', body: JSON.stringify(input) });
}

export function updateCareMetricMedication(id: string, input: { expirationDate?: string; status?: 'current' | 'due_soon' | 'expired' | 'missing_documentation'; notes?: string }) {
  return request(`/caremetric/medications/${id}`, { method: 'POST', body: JSON.stringify(input) });
}

export function createCareMetricNotification(input: { user: string; title: string; body: string }) {
  return request('/caremetric/notifications', { method: 'POST', body: JSON.stringify(input) });
}

export function createCareMetricBinderExport(input: { format: 'pdf' | 'csv'; sections: string[]; facility?: string }) {
  return request('/caremetric/binder-export', { method: 'POST', body: JSON.stringify(input) });
}
