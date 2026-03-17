from functools import partial


def doc_to_text(doc):
    prompt = (
        "Given the following question and four candidate answers "
        "(A, B, C and D), choose the best answer.\n\n"
        f'Question: {doc["question"].strip()}\n\n'
    )
    for i, choice in enumerate(doc["choices"]):
        prompt += f'{"ABCD"[i]}. {choice}\n\n'
    prompt += (
        'Your response should end with "The best answer is [the_answer_letter]" '
        "where the [the_answer_letter] is one of A, B, C or D."
    )
    return prompt


def process_docs(dataset, category):
    return dataset.filter(lambda x: x["category"] == category)


process_coding = partial(process_docs, category="coding")
process_math_reasoning = partial(process_docs, category="math_reasoning")
process_humanities = partial(process_docs, category="humanities")
process_science_knowledge = partial(process_docs, category="science_knowledge")
process_general = partial(process_docs, category="general")
