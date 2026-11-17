import UIKit

struct SettingsIndexState: Decodable {
  struct Row: Decodable {
    let id: String
    let title: String
    let symbol: String
  }

  let title: String
  let done: String
  let groups: [[Row]]
}

final class SettingsIndex: UITableViewController {
  private let state: SettingsIndexState
  private let select: (String) -> Void

  init(state: SettingsIndexState, select: @escaping (String) -> Void) {
    self.state = state
    self.select = select
    super.init(style: .insetGrouped)
  }

  required init?(coder: NSCoder) { nil }

  override func viewDidLoad() {
    super.viewDidLoad()
    title = state.title
    navigationItem.largeTitleDisplayMode = .always
    navigationItem.rightBarButtonItem = UIBarButtonItem(title: state.done, style: .done, target: self, action: #selector(close))
    tableView.register(UITableViewCell.self, forCellReuseIdentifier: "Setting")
    tableView.estimatedRowHeight = 52
    tableView.rowHeight = UITableView.automaticDimension
  }

  @objc private func close() { finish("") }

  private func finish(_ choice: String) {
    dismiss(animated: true) { self.select(choice) }
  }

  override func numberOfSections(in tableView: UITableView) -> Int { state.groups.count }

  override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
    state.groups[section].count
  }

  override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
    let row = state.groups[indexPath.section][indexPath.row]
    let cell = tableView.dequeueReusableCell(withIdentifier: "Setting", for: indexPath)
    var content = cell.defaultContentConfiguration()
    content.text = row.title
    content.image = UIImage(systemName: row.symbol)
    content.imageProperties.tintColor = view.tintColor
    cell.contentConfiguration = content
    cell.accessoryType = .disclosureIndicator
    cell.accessibilityIdentifier = "settings-\(row.id)"
    return cell
  }

  override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
    tableView.deselectRow(at: indexPath, animated: true)
    finish(state.groups[indexPath.section][indexPath.row].id)
  }
}
