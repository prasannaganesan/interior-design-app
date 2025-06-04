import ColorPicker from './ColorPicker';
import { PlusIcon, TrashIcon } from './Icons';
import { WallGroup, WallSurface } from '../types/wall';
import { Dispatch, SetStateAction } from 'react';

interface GroupsSidebarProps {
  groups: WallGroup[];
  walls: WallSurface[];
  newGroupName: string;
  editingNames: Record<string, string>;
  editingGroupId: string | null;
  setNewGroupName: Dispatch<SetStateAction<string>>;
  setEditingGroupId: Dispatch<SetStateAction<string | null>>;
  addGroup: () => void;
  handleGroupNameChange: (groupId: string, name: string) => void;
  commitGroupName: (groupId: string) => void;
  allowDrop: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent<HTMLElement>, groupId: string | null) => void;
  handleDragStart: (e: React.DragEvent<HTMLLIElement>, wallId: string) => void;
  toggleWall: (id: string) => void;
  removeWall: (wallId: string) => void;
  previewGroupColor: (groupId: string, color: string) => void;
  commitGroupColor: (groupId: string, color: string) => void;
}

export default function GroupsSidebar({
  groups,
  walls,
  newGroupName,
  editingNames,
  editingGroupId,
  setNewGroupName,
  setEditingGroupId,
  addGroup,
  handleGroupNameChange,
  commitGroupName,
  allowDrop,
  handleDrop,
  handleDragStart,
  toggleWall,
  removeWall,
  previewGroupColor,
  commitGroupColor
}: GroupsSidebarProps) {
  return (
    <>
      <h2>Groups</h2>
      <p className="instructions">
        Drag surfaces here to organize them. Edit the names below and use the
        color picker to set a group's color.
      </p>
      <h3>Add Group</h3>
      <div className="add-group-row">
        <input
          type="text"
          className="group-name-input"
          placeholder="Enter group name"
          value={newGroupName}
          onChange={e => setNewGroupName(e.target.value)}
        />
        <button className="add-group" onClick={addGroup} title="Add group">
          <PlusIcon />
          <span>Add</span>
        </button>
      </div>
      {groups.map(g => (
        <div key={g.id} className="group-section">
          <div className="group-header">
            {editingGroupId === g.id ? (
              <input
                type="text"
                className="group-name-input"
                value={editingNames[g.id] ?? g.name}
                autoFocus
                onChange={e => handleGroupNameChange(g.id, e.target.value)}
                onBlur={() => commitGroupName(g.id)}
                onKeyDown={e =>
                  e.key === 'Enter' &&
                  (e.currentTarget as HTMLInputElement).blur()}
              />
            ) : (
              <span
                className="group-name-display"
                onClick={() => setEditingGroupId(g.id)}
              >
                {g.name}
              </span>
            )}
            <label className="color-picker-label">
              Group color
              <ColorPicker
                value={g.color}
                onChange={c => previewGroupColor(g.id, c)}
                onChangeComplete={c => commitGroupColor(g.id, c)}
              />
            </label>
          </div>
          <ul
            className="group-surfaces"
            onDragOver={allowDrop}
            onDrop={e => handleDrop(e, g.id)}
          >
            {walls.filter(w => w.groupId === g.id).length === 0 ? (
              <li
                className="drop-placeholder"
                onDragOver={allowDrop}
                onDrop={e => handleDrop(e, g.id)}
              >
                Drop surfaces here
              </li>
            ) : (
              walls
                .filter(w => w.groupId === g.id)
                .map(w => (
                  <li
                    key={w.id}
                    className="draggable"
                    draggable
                    onDragStart={e => handleDragStart(e, w.id)}
                    onDragOver={allowDrop}
                    onDrop={e => handleDrop(e, g.id)}
                  >
                    <label>
                      <input type="checkbox" checked={w.enabled} onChange={() => toggleWall(w.id)} /> {w.id}
                    </label>
                    <button
                      className="remove-btn"
                      title="Delete surface"
                      onClick={() => removeWall(w.id)}
                    >
                      <TrashIcon />
                    </button>
                  </li>
                ))
            )}
          </ul>
        </div>
      ))}
      {walls.filter(w => !w.groupId).length > 0 && (
        <div className="group-section">
          <div className="group-header"><span>Other</span></div>
          <ul
            className="group-surfaces"
            onDragOver={allowDrop}
            onDrop={e => handleDrop(e, null)}
          >
            {walls.filter(w => !w.groupId).map(w => (
              <li
                key={w.id}
                className="draggable"
                draggable
                onDragStart={e => handleDragStart(e, w.id)}
                onDragOver={allowDrop}
                onDrop={e => handleDrop(e, null)}
              >
                <label>
                  <input type="checkbox" checked={w.enabled} onChange={() => toggleWall(w.id)} /> {w.id}
                </label>
                <button
                  className="remove-btn"
                  title="Delete surface"
                  onClick={() => removeWall(w.id)}
                >
                  <TrashIcon />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
