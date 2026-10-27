import { describe, expect, it } from 'vitest';
import { pointsChanged, pointsForm, pointsSettings, type PointsMethod } from '../src/lib/points.js';

const position: PointsMethod = {
  name: 'Position',
  label: 'Position',
  settings: [
    { name: 'points_list', label: 'Points (CSV)', field_type: 'text', placeholder: '10,6,3,1' }
  ]
};
const fancy: PointsMethod = {
  name: 'Fancy',
  label: 'Fancy',
  settings: [
    { name: 'bonus', label: 'Bonus', field_type: 'basic_int', value: 2 },
    { name: 'double', label: 'Double', field_type: 'checkbox', value: false }
  ]
};

describe('pointsForm', () => {
  it('starts from stored values, then field defaults, as strings', () => {
    expect(pointsForm(position, null)).toEqual({ points_list: '' });
    expect(pointsForm(position, { points_list: '10,8' })).toEqual({ points_list: '10,8' });
    expect(pointsForm(fancy, null)).toEqual({ bonus: '2', double: 'false' });
    expect(pointsForm(undefined, { x: 1 })).toEqual({});
  });
});

describe('pointsSettings', () => {
  it('types each field and is null for a method without settings', () => {
    expect(pointsSettings(position, { points_list: '10,8,6' })).toEqual({ points_list: '10,8,6' });
    expect(pointsSettings(fancy, { bonus: '3', double: 'true' })).toEqual({
      bonus: 3,
      double: true
    });
    expect(pointsSettings(fancy, { bonus: '', double: '' })).toEqual({
      bonus: null,
      double: false
    });
    expect(pointsSettings({ name: 'n', label: 'n', settings: [] }, {})).toBeNull();
    expect(pointsSettings(undefined, {})).toBeNull();
  });
});

describe('pointsChanged', () => {
  it('compares what would be written with what is stored', () => {
    expect(pointsChanged({ points_list: '10,8' }, { points_list: '10,8' })).toBe(false);
    expect(pointsChanged({ points_list: '10,8' }, null)).toBe(true);
    expect(pointsChanged({ points_list: '10,8' }, { points_list: '10,6' })).toBe(true);
    expect(pointsChanged(null, { points_list: '10,6' })).toBe(false);
  });
});
