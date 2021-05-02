def errors_as_json_tree(errors):
    json = {}
    for error in errors:
        path = error[0]
        message = error[1]
        item = json
        for index, token in enumerate(path):
            if index == len(path) - 1:
                item[token] = message
            else:
                if token in item:
                    item = item[token]
                else:
                    new_item = {}
                    item[token] = new_item
                    item = new_item
    return json