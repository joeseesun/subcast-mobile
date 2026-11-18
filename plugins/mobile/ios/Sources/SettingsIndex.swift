import UIKit

struct SettingsIndexState: Decodable {
  struct Row: Decodable {
    let id: String
    let title: String
    let symbol: String?
    let selected: Bool?
  }

  let title: String
  let done: String
  let groups: [[Row]]
  let choiceSheet: Bool?
}

final class SettingsIndex: UITableViewController, UISheetPresentationControllerDelegate {
  private let state: SettingsIndexState
  private let select: (String) -> Void
  private var answered = false

  init(state: SettingsIndexState, select: @escaping (String) -> Void) {
    self.state = state
    self.select = select
    super.init(style: .insetGrouped)
  }

  required init?(coder: NSCoder) { nil }

  override func viewDidLoad() {
    super.viewDidLoad()
    title = state.title
    navigationItem.largeTitleDisplayMode = state.choiceSheet == true ? .never : .always
    navigationItem.rightBarButtonItem = UIBarButtonItem(
      title: state.done, style: state.choiceSheet == true ? .plain : .done, target: self, action: #selector(close)
    )
    if state.choiceSheet == true { tableView.sectionHeaderTopPadding = 12 }
    tableView.backgroundColor = UIColor { trait in
      trait.userInterfaceStyle == .dark
        ? UIColor(red: 0.10, green: 0.08, blue: 0.07, alpha: 1)
        : UIColor(red: 0.98, green: 0.96, blue: 0.93, alpha: 1)
    }
    tableView.register(UITableViewCell.self, forCellReuseIdentifier: "Setting")
    tableView.estimatedRowHeight = 52
    tableView.rowHeight = UITableView.automaticDimension
  }

  @objc private func close() { finish("") }

  private func finish(_ choice: String) {
    dismiss(animated: true) { self.report(choice) }
  }

  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    report("")
  }

  private func report(_ choice: String) {
    guard !answered else { return }
    answered = true
    select(choice)
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
    if let symbol = row.symbol { content.image = UIImage(systemName: symbol) }
    content.imageProperties.tintColor = view.tintColor
    cell.contentConfiguration = content
    cell.backgroundColor = UIColor { trait in
      trait.userInterfaceStyle == .dark
        ? UIColor(red: 0.14, green: 0.11, blue: 0.09, alpha: 1)
        : UIColor(red: 1, green: 0.99, blue: 0.97, alpha: 1)
    }
    if let selected = row.selected {
      cell.accessoryType = selected ? .checkmark : .none
      if selected { cell.accessibilityTraits.insert(.selected) }
      else { cell.accessibilityTraits.remove(.selected) }
    } else {
      cell.accessoryType = .disclosureIndicator
    }
    cell.accessibilityIdentifier = "settings-\(row.id)"
    return cell
  }

  override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
    tableView.deselectRow(at: indexPath, animated: true)
    let row = state.groups[indexPath.section][indexPath.row]
    if row.selected == false { UISelectionFeedbackGenerator().selectionChanged() }
    finish(row.id)
  }
}
